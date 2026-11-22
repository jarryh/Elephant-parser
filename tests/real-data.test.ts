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
import { parseLua } from '../src/shared/lua';
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
});
