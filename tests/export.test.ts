import { describe, expect, it } from 'vitest';
import { parseElephant } from '../src/shared/elephant';
import { exportJson, exportLua, exportMarkdown, exportText } from '../src/shared/export';
import { channelLabels, NO_FILTERS, RP_TYPES, type Filters } from '../src/shared/filter';
import { createClock } from '../src/shared/format';
import { parseLua } from '../src/shared/lua';
import { computeSelection } from '../src/shared/selection';
import type { LogDocument, LogItem } from '../src/shared/types';
import { FIXTURE, FIXTURE_CRLF, referenceParse, toPlain, type Plain } from './helpers';

const clock = createClock('UTC');
const doc = parseElephant(FIXTURE);
const id = (text: string) => doc.items.find((item) => item.text.includes(text))!.id;

function cleaned(filters: Partial<Filters> = {}, removed: string[] = [], from: LogDocument = doc) {
  const selection = computeSelection(from, { ...NO_FILTERS, ...filters }, new Set(removed));
  return { ...selection, lua: exportLua(from, selection.states) };
}

function path(value: Plain, ...keys: (string | number)[]): Plain {
  return keys.reduce<Plain>((at, key) => (at as [Plain, Plain][]).find(([k]) => k === key)![1], value);
}

describe('Lua export', () => {
  it.each([
    ['LF', FIXTURE],
    ['CRLF', FIXTURE_CRLF],
  ])('is byte-for-byte the original when everything is kept (%s)', (_name, source) => {
    const parsed = parseElephant(source);
    expect(cleaned({}, [], parsed).lua).toBe(source);
  });

  const cases: [string, Partial<Filters>, string[]][] = [
    ['one channel', { channels: ['#4'] }, []],
    ['a shared message, one channel', { channels: ['#3'] }, []],
    ['named channels', { channels: ['general', 'ooc - testville'] }, []],
    ['a period', { from: 1898622200, to: 1898622300 }, []],
    ['one sender', { senders: ['Borin Fixture'] }, []],
    ['roleplay types', { types: RP_TYPES }, []],
    ['one character', { owners: ['Dorn Placeholder'] }, []],
    ['nothing', { text: 'matches nothing' }, []],
    ['removals', {}, [id('gates'), id('bows'), id('First')]],
    ['everything removed', {}, doc.items.map((item) => item.id)],
  ];

  for (const [style, source] of [
    ['LF', FIXTURE],
    ['CRLF', FIXTURE_CRLF],
  ] as const) {
    const parsed = parseElephant(source);

    it.each(cases)(`parses back to exactly the kept messages: %s (${style})`, (_name, filters, removed) => {
      const { lua, messages } = cleaned(filters, removed, parsed);
      expect(toPlain(parseLua(lua).get('ElephantDB')!)).toEqual(referenceParse(lua));

      const back = parseElephant(lua).items.filter((item) => item.kind === 'message');
      const facts = (items: LogItem[]) =>
        items.map(({ owner, time, type, raw }) => JSON.stringify([owner, time, type, raw])).sort();
      expect(facts(back)).toEqual(facts(messages));
    });
  }

  it('keeps IDs, so edits still apply to a cleaned file', () => {
    const { lua, messages } = cleaned({ channels: ['#4'] });
    const back = parseElephant(lua).items.filter((item) => item.kind === 'message');
    expect(back.map((item) => item.id)).toEqual(messages.map((item) => item.id));
  });

  it('keeps settings and built-in log numbers', () => {
    const before = referenceParse(FIXTURE);
    const after = referenceParse(cleaned({ text: 'matches nothing' }).lua);
    expect(path(after, 'profileKeys')).toEqual(path(before, 'profileKeys'));
    const numbers = (value: Plain) =>
      (path(value, 'char', 'Élowyn Testwood', 'logs') as [Plain, Plain][]).map(([key]) => key);
    expect(numbers(after)).toEqual(numbers(before));
  });

  it('renumbers explicit keys, leaving no holes', () => {
    const log = path(referenceParse(cleaned({}, [id('Second')]).lua), 'char', 'Dorn Placeholder', 'logs', 4, 'logs');
    expect((log as [Plain, Plain][]).map(([key]) => key)).toEqual([1, 2]);
    expect(path(log, 2, 'arg1')).toBe('Third');
  });

  it('stops Elephant overwriting the new last line at the next login', () => {
    const raid = (lua: string) => path(referenceParse(lua), 'char', 'Élowyn Testwood', 'logs', 2, 'hasMessage');
    expect(raid(FIXTURE)).toBe(false);
    expect(raid(cleaned({}, [id('gates')]).lua)).toBe(true);
  });

  it('leaves no blank lines or stray comments behind', () => {
    const source = 'ElephantDB = {\n\t["char"] = {\n\t\t["A"] = {\n\t\t\t["logs"] = {\n\t\t\t\t{\n\t\t\t\t\t["logs"] = {\n'
      + '\t\t\t\t\t\t{\n\t\t\t\t\t\t\t["time"] = 1,\n\t\t\t\t\t\t}, -- [1]\n'
      + '\t\t\t\t\t\t{\n\t\t\t\t\t\t\t["time"] = 2,\n\t\t\t\t\t\t}, -- [2]\n'
      + '\t\t\t\t\t},\n\t\t\t\t},\n\t\t\t},\n\t\t},\n\t},\n}\n';
    const expected = source.replace('\t\t\t\t\t\t{\n\t\t\t\t\t\t\t["time"] = 1,\n\t\t\t\t\t\t}, -- [1]\n', '');
    expect(cleaned({ from: 2 }, [], parseElephant(source)).lua).toBe(expected);
  });

  it('copes with entries sharing a line', () => {
    const source = 'ElephantDB={char={A={logs={{logs={{time=1},{time=2},{time=3}}}}}}}';
    const { lua } = cleaned({ from: 2, to: 2 }, [], parseElephant(source));
    expect(parseElephant(lua).items.map((item) => item.time)).toEqual([2]);
  });
});

describe('text exports', () => {
  const { messages } = cleaned({ channels: ['#4'], from: 1898622200, to: 1898622220 });

  it('writes plain text', () => {
    const day = clock.day(1898622200);
    const times = [1898622200, 1898622210, 1898622220].map((time) => clock.time(time));
    expect(exportText(messages, clock)).toBe(
      [
        `=== ${day} ===`,
        `[${times[0]}] [Say] Élowyn Testwood: Well met, "traveller".`,
        `[${times[1]}] [Emote] Borin Fixture bows \\ deeply.`,
        `[${times[2]}] [Built-in emote] Borin Fixture waves at you.`,
        '',
      ].join('\n'),
    );
  });

  it('writes Markdown', () => {
    const markdown = exportMarkdown(messages, clock);
    expect(markdown).toContain(`## ${clock.day(1898622200)}`);
    expect(markdown).toContain('*Say* **Élowyn Testwood**: Well met, "traveller".');
  });

  it('keeps chat from injecting Markdown or HTML', () => {
    const hostile = { ...messages[0]!, text: '![x](https://evil.example/p.png) <img src=x>' };
    const markdown = exportMarkdown([hostile], clock);
    expect(markdown).not.toContain('![x]');
    expect(markdown).not.toMatch(/[^\\]<img/);
  });

  it('writes JSON', () => {
    const { messages: rows } = JSON.parse(exportJson(messages, channelLabels(doc)));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ type: 'SAY', channels: ['Say'], unixTime: 1898622200 });
  });
});
