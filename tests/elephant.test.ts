import { describe, expect, it } from 'vitest';
import { NotElephantFileError, parseElephant } from '../src/shared/elephant';
import { FIXTURE, FIXTURE_CRLF } from './helpers';

const doc = parseElephant(FIXTURE);
const byText = (text: string) => doc.items.filter((item) => item.text.includes(text));

describe('parseElephant', () => {
  it('finds character and shared logs', () => {
    expect([...new Set(doc.logs.map((log) => log.owner))]).toEqual([
      'Élowyn Testwood',
      'Dorn Placeholder',
      'Alliance - Testrealm (shared)',
    ]);
  });

  it('names built-in logs by ID, even across nil holes', () => {
    const labels = doc.logs.filter((log) => log.owner === 'Élowyn Testwood').map((log) => log.label);
    expect(labels).toEqual(['Whisper', 'Raid', 'Party', 'Say', 'Loot', 'System', 'General', 'OOC - Testville']);
  });

  it('merges a message that was logged to several logs', () => {
    const yells = byText('gates open');
    expect(yells).toHaveLength(1);
    expect(yells[0]!.channels).toEqual(['#2', '#3']);
    expect(doc.entries.filter((entry) => entry.id === yells[0]!.id)).toHaveLength(2);
  });

  it('keeps identical lines within one log apart', () => {
    const loot = byText('Fixture Cloak');
    expect(loot).toHaveLength(2);
    expect(loot[0]!.id).not.toBe(loot[1]!.id);
  });

  it('keeps the same notice in two channels apart', () => {
    expect(byText('You joined channel.').map((item) => item.channels)).toEqual([['general'], ['ooc - testville']]);
  });

  it('separates messages, markers and spacers', () => {
    const count = (kind: string) => doc.items.filter((item) => item.kind === kind).length;
    expect(count('spacer')).toBe(2);
    expect(count('marker')).toBe(5);
    expect(count('message')).toBe(doc.items.length - 7);
  });

  it('places a session marker just before that session', () => {
    const marker = byText('03/02/2030')[0]!;
    const first = byText('A new evening begins.')[0]!;
    expect(marker.at).toBe(first.time);
    expect(doc.items.indexOf(marker)).toBeLessThan(doc.items.indexOf(first));
  });

  it('dates a marker in a log without messages by its text, not 1970', () => {
    const source =
      'ElephantDB={char={A={logs={{logs={{type="SYSTEM",arg1="Logging started for A on 03/04/2030 at 05:06:07."}}}}}}}';
    expect(parseElephant(source).items[0]!.at).toBe(new Date(2030, 2, 4, 5, 6, 7).getTime() / 1000);
  });

  it('puts everything in time order', () => {
    const times = doc.items.map((item) => item.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it.each([
    ['You receive item', 'You receive item: [Fixture Cloak].', null],
    ['Straw Golem', 'Straw Golem creaks ominously.', 'Straw Golem'],
    ['waves at you', 'Borin Fixture waves at you.', 'Borin Fixture'],
    ['You wave back', 'You wave back.', 'Élowyn Testwood'],
    ['battle net', 'a battle net note', 'Example#0000'],
    ['(...)', '(...)', null],
    ['[Guild] Cedra', '[Guild] Cedra: hello', null],
    ['red door', 'Anyone seen the red door?', 'Cedra Mock'],
  ])('reads the line with %j', (needle, text, sender) => {
    expect(byText(needle)[0]).toMatchObject({ text, sender });
  });

  it('keeps colour, flag and channel name', () => {
    expect(byText('red door')[0]).toMatchObject({
      color: '#3fc7eb',
      flag: 'NEWCOMER',
      channelName: 'General - Testville',
    });
  });

  it.each([
    ['LF', FIXTURE],
    ['CRLF', FIXTURE_CRLF],
  ])('records positions that point at whole entries (%s)', (_name, source) => {
    const parsed = parseElephant(source);
    const lines = source.split(/\r?\n/);
    for (const entry of parsed.entries) {
      expect(source.slice(entry.start, entry.end)).toMatch(/^(?:\[\d+\] = )?\{[\s\S]*\},?$/);
      expect(lines[entry.startLine - 1]).toMatch(/^(?:\[\d+\] = )?\{$/);
      expect(lines[entry.endLine - 1]).toMatch(/^\},/);
    }
  });

  it('rejects other addons and broken files', () => {
    expect(() => parseElephant('OtherDB = {}')).toThrow(NotElephantFileError);
    expect(() => parseElephant('ElephantDB = { ["profiles"] = {} }')).toThrow(NotElephantFileError);
    expect(() => parseElephant(FIXTURE.slice(0, 500))).toThrow(/Line \d+/);
  });
});

describe('item IDs', () => {
  const ids = new Set(doc.items.map((item) => item.id));

  it('do not depend on line endings', () => {
    expect(parseElephant(FIXTURE_CRLF).items.map((item) => item.id)).toEqual(doc.items.map((item) => item.id));
  });

  it('survive new messages being appended', () => {
    const anchor = '},\n["hasMessage"] = true,\n["enabled"] = true,\n}, -- [4]';
    const grown = FIXTURE.replace(
      anchor,
      `{\n["arg2"] = "Cedra Mock",\n["type"] = "SAY",\n["time"] = 1898714000,\n["arg1"] = "Later",\n},\n${anchor}`,
    );
    expect(grown).not.toBe(FIXTURE);
    const after = new Set(parseElephant(grown).items.map((item) => item.id));
    expect(after.size).toBe(ids.size + 1);
    for (const id of ids) expect(after).toContain(id);
  });

  it('survive Elephant deleting the oldest lines', () => {
    const say = doc.entries.filter(
      (entry) => doc.logs[entry.log]!.owner === 'Élowyn Testwood' && doc.logs[entry.log]!.channel === '#4',
    );
    const trimmed = parseElephant(FIXTURE.slice(0, say[0]!.start) + FIXTURE.slice(say[2]!.start));
    const after = new Set(trimmed.items.map((item) => item.id));
    const expected = [...ids].filter((id) => id !== say[0]!.id && id !== say[1]!.id);
    expect([...after].sort()).toEqual(expected.sort());
  });
});
