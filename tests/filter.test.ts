import { describe, expect, it } from 'vitest';
import { parseElephant } from '../src/shared/elephant';
import {
  compareChannels,
  computeFacets,
  createMatcher,
  fold,
  NO_FILTERS,
  RP_TYPES,
  type Filters,
} from '../src/shared/filter';
import { createClock } from '../src/shared/format';
import { FIXTURE } from './helpers';

const doc = parseElephant(FIXTURE);
const texts = (filters: Partial<Filters>) =>
  doc.items.filter(createMatcher({ ...NO_FILTERS, ...filters })).map((item) => item.text);

describe('filters', () => {
  it('show all messages, and no markers or spacers, by default', () => {
    expect(texts({})).toHaveLength(doc.items.filter((item) => item.kind === 'message').length);
  });

  it('can show markers, but never spacers', () => {
    const all = texts({ showMarkers: true });
    expect(all.filter((text) => text.startsWith('Logging started'))).toHaveLength(5);
    expect(all).not.toContain(' ');
  });

  it('get one channel in one period', () => {
    expect(texts({ channels: ['#4'], from: 1898622205, to: 1898622230 })).toEqual([
      'bows \\ deeply.',
      'Borin Fixture waves at you.',
      'You wave back.',
    ]);
  });

  it('include both ends of the period', () => {
    expect(texts({ from: 1898622200, to: 1898622200 })).toEqual(['Well met, "traveller".']);
  });

  it('find a shared message through any of its channels', () => {
    expect(texts({ channels: ['#2'] })).toEqual(['The test gates open!']);
    expect(texts({ channels: ['#3'] })).toContain('The test gates open!');
  });

  it('merge several channels into one timeline', () => {
    expect(texts({ channels: ['general', 'ooc - testville'] })).toEqual([
      'You joined channel.',
      'You joined channel.',
      'Anyone seen the red door?',
      '((brb, tea))',
    ]);
  });

  it('filter by character', () => {
    expect(texts({ owners: ['Dorn Placeholder'] })).toEqual(['First', 'Second', 'Third']);
  });

  it('filter by type', () => {
    expect(texts({ types: ['MONEY'] })).toEqual(['You loot 1 Copper']);
    expect(texts({ types: RP_TYPES }).join()).not.toMatch(/secret|receive item|red door/);
  });

  it('filter by sender, including built-in emotes', () => {
    expect(texts({ senders: ['Borin Fixture'] })).toContain('Borin Fixture waves at you.');
  });

  it('search text and senders, ignoring case and accents', () => {
    expect(texts({ text: 'RED DOOR' })).toEqual(['Anyone seen the red door?']);
    expect(texts({ text: 'elowyn' })).toContain('A new evening begins.');
    expect(fold('Žluťoučký Élowyn')).toBe('zlutoucky elowyn');
  });

  it('combine', () => {
    expect(texts({ channels: ['#4'], senders: ['Borin Fixture'], types: ['EMOTE'], text: 'bow' })).toEqual([
      'bows \\ deeply.',
    ]);
  });
});

describe('facets', () => {
  const clock = createClock('UTC');

  it('follow the characters and period', () => {
    const facets = computeFacets(doc, { owners: ['Dorn Placeholder'], from: 1898800010, to: null }, clock.day);
    expect([...facets.channels]).toEqual([['#4', 2]]);
    expect([...facets.days.values()]).toEqual([3]);
    expect(facets.owners.size).toBe(3);
  });

  it('sort built-in channels before named ones', () => {
    expect(['trade', '#10', 'general', '#2'].sort(compareChannels)).toEqual(['#2', '#10', 'general', 'trade']);
  });
});
