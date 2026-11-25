/**
 * Checks against your own Data/Elephant.lua. Skipped when there is none.
 *
 * The repository is public: compare against what is computed from the file, and never
 * write its names, text or counts into a test. Assert on booleans and numbers, so a
 * failure doesn't print private chat.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseElephant } from '../src/shared/elephant';
import { exportLua } from '../src/shared/export';
import { NO_FILTERS, RP_TYPES } from '../src/shared/filter';
import { parseLua } from '../src/shared/lua';
import { computeSelection } from '../src/shared/selection';
import { referenceParse, toPlain } from './helpers';

const path = fileURLToPath(new URL('../Data/Elephant.lua', import.meta.url));
const present = existsSync(path);

describe.skipIf(!present)('the real Data/Elephant.lua', () => {
  const bytes = present ? readFileSync(path) : Buffer.alloc(0);
  const source = bytes.toString('utf8');
  const lines = source.split(/\r\n|\r|\n/);
  const count = (pattern: RegExp) => lines.filter((line) => pattern.test(line)).length;

  it('is valid UTF-8, so nothing is lost on loading', () => {
    expect(Buffer.from(source, 'utf8').equals(bytes)).toBe(true);
  });

  it('parses to exactly what a reference parser sees', () => {
    const ours = toPlain(parseLua(source).get('ElephantDB')!);
    expect(isDeepStrictEqual(ours, referenceParse(source))).toBe(true);
  });

  it('accounts for every logged line', () => {
    const doc = parseElephant(source);
    const byId = new Map(doc.items.map((item) => [item.id, item]));
    const physical = doc.entries.map((entry) => byId.get(entry.id)!);

    expect(physical.filter((item) => item.time !== null).length).toBe(count(/^\s*\["time"\] = \d/));
    expect(physical.filter((item) => item.type).length).toBe(count(/^\s*\["type"\] = "/));
    expect(physical.filter((item) => item.kind === 'spacer').length).toBe(count(/^\s*\["arg1"\] = " ",?$/));

    const typesInFile = lines.flatMap((line) => /^\s*\["type"\] = "([^"]+)"/.exec(line)?.[1] ?? []);
    expect(new Set(physical.flatMap((item) => item.type || [])).size).toBe(new Set(typesInFile).size);

    const db = referenceParse(source) as [unknown, unknown][];
    const characters = db.find(([key]) => key === 'char')![1] as unknown[];
    expect(new Set(doc.logs.map((log) => log.owner)).size).toBe(characters.length);
  });

  it('points every entry at whole lines', () => {
    const misplaced = parseElephant(source).entries.filter(
      (entry) =>
        !/^\s*(\[\d+\] = )?\{$/.test(lines[entry.startLine - 1]!) || !/^\s*\}/.test(lines[entry.endLine - 1]!),
    );
    expect(misplaced.length).toBe(0);
  });

  it('dates every message and marker', () => {
    const undated = parseElephant(source).items.filter((item) => item.kind !== 'spacer' && item.at === 0);
    expect(undated.length).toBe(0);
  });

  it('exports unchanged when everything is kept', () => {
    const doc = parseElephant(source);
    const { states } = computeSelection(doc, NO_FILTERS, new Set());
    expect(exportLua(doc, states) === source).toBe(true);
  });

  it('exports valid Lua with exactly the kept messages', () => {
    const doc = parseElephant(source);
    const times = doc.items.flatMap((item) => item.time ?? []);
    const cases = [
      { filters: NO_FILTERS, removed: doc.items.filter((_, i) => i % 3 === 0).map((item) => item.id) },
      { filters: { ...NO_FILTERS, channels: ['#3'] }, removed: [] },
      { filters: { ...NO_FILTERS, types: RP_TYPES, from: times[Math.floor(times.length / 2)]! }, removed: [] },
    ];
    for (const { filters, removed } of cases) {
      const { messages, states } = computeSelection(doc, filters, new Set(removed));
      const lua = exportLua(doc, states);
      expect(isDeepStrictEqual(toPlain(parseLua(lua).get('ElephantDB')!), referenceParse(lua))).toBe(true);

      const back = parseElephant(lua).items.filter((item) => item.kind === 'message');
      // Compared by content, as cutting one of two identical lines renumbers the other.
      const facts = (items: typeof back) => items.map((m) => JSON.stringify([m.owner, m.time, m.type, m.raw])).sort();
      expect(isDeepStrictEqual(facts(back), facts(messages))).toBe(true);
    }
  });
});
