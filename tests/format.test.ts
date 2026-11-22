import { describe, expect, it } from 'vitest';
import { parseElephant } from '../src/shared/elephant';
import { createClock, lineTag, speaker, typeLabel } from '../src/shared/format';
import { FIXTURE } from './helpers';

const doc = parseElephant(FIXTURE);

describe('format', () => {
  it.each([
    ['Well met', 'Élowyn Testwood: Well met, "traveller".'],
    ['bows', 'Borin Fixture bows \\ deeply.'],
    ['waves at', 'Borin Fixture waves at you.'],
    ['creaks', 'Straw Golem creaks ominously.'],
    ['gates', 'Gatekeeper Dummy yells: The test gates open!'],
    ['secret', 'Borin Fixture whispers: a private secret'],
    ['answer', 'To Borin Fixture: a private answer'],
  ])('writes the line with %j', (needle, expected) => {
    const item = doc.items.find((entry) => entry.text.includes(needle))!;
    const who = speaker(item);
    expect(`${who ? who.before + who.name + who.after : ''}${item.text}`).toBe(expected);
  });

  it('labels lines by channel, or else by type', () => {
    expect(lineTag(doc.items.find((item) => item.text.includes('red door'))!)).toBe('General - Testville');
    expect(lineTag(doc.items.find((item) => item.text.includes('bows'))!)).toBe('Emote');
    expect(typeLabel('SOME_NEW_TYPE')).toBe('Some new type');
  });

  it('formats in a timezone, through DST and midnight', () => {
    const prague = createClock('Europe/Prague');
    const seconds = (iso: string) => Date.parse(iso) / 1000;
    expect(prague.time(seconds('2030-01-15T23:30:59Z'))).toBe('00:30');
    expect(prague.day(seconds('2030-01-15T23:30:59Z'))).toBe('2030-01-16');
    expect(prague.time(seconds('2030-07-15T12:00:00Z'))).toBe('14:00');
  });
});
