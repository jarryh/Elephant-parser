import { describe, expect, it } from 'vitest';
import { parseElephant } from '../src/shared/elephant';
import {
  channelLabels,
  compareChannels,
  computeFacets,
  createMatcher,
  fold,
  NO_FILTERS,
  RP_TYPES,
  type Filters,
} from '../src/shared/filter';
import { createClock } from '../src/shared/format';
import { parseLog } from '../src/shared/parse';
import { FIXTURE, STORYLOG } from './helpers';

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

describe('StoryLog filters', () => {
  const story = parseLog(STORYLOG);
  const found = (filters: Partial<Filters>) =>
    story.items.filter(createMatcher({ ...NO_FILTERS, ...filters }, story.places)).map((item) => item.text);

  it('filter by zone, or by a place within it', () => {
    expect(found({ places: ['The Stockade'] })).toEqual([
      'Dark in here.',
      '14 messages hidden by the game',
      '[A Test of Patience]',
      'That was close.',
    ]);
    expect(found({ places: ["Elwynn Forest › Goldshire, Lion's Pride Inn"] })).toEqual(['A new evening begins.']);
    const elwynn = found({ places: ['Elwynn Forest'] });
    expect(elwynn).toEqual(expect.arrayContaining(['A new evening begins.', 'Ready when you are.']));
    expect(elwynn).not.toContain('Took the road. See you at the gate.');
  });

  it('match nothing by place in a file without places', () => {
    expect(texts({ places: ['Stormwind City'] })).toEqual([]);
  });

  it('show notes without "Show markers", whatever the channel, type or sender', () => {
    expect(found({})).toContain('Note: The bargain');
    expect(found({ channels: ['#3'], types: ['PARTY'], senders: ['Borin Fixture'] })).toContain('Note: The bargain');
  });

  it('show the group where it changes, in the same way', () => {
    expect(found({ channels: ['#3'], types: ['PARTY'] })).toContain('In a party with Borin Ironvow');
    expect(found({ from: 1898622001 })).not.toContain('In a party with Borin Ironvow');
  });

  it('keep quests with the roleplay types, in a channel of their own', () => {
    expect(found({ types: RP_TYPES }).filter((text) => text.includes('Test of Patience'))).toHaveLength(2);
    expect(found({ channels: ['quests'] })).toEqual([
      'In a party with Borin Ironvow',
      'Note: The bargain',
      '[A Test of Patience], from Gatekeeper Dummy',
      '14 messages hidden by the game',
      '[A Test of Patience]',
      'Joined a party with Borin Ironvow, led by Élowyn Moonwhisper',
      '[Lost Necklace], from Innkeeper Farley',
      'Note: Into Westfall',
    ]);
  });

  it('keep what happened with the roleplay types, each in a channel of its own', () => {
    expect(found({ types: RP_TYPES })).toEqual(
      expect.arrayContaining(['Traded with Borin Ironvow: gave 15s; got [Linen Cloth] ×5', 'Fought Defias Thug (25 s)']),
    );
    const fights = story.items
      .filter(createMatcher({ ...NO_FILTERS, channels: ['@fights'] }, story.places))
      .filter((item) => item.kind === 'message');
    expect(fights.map((item) => item.text)).toEqual([
      'Fought Defias Thug (25 s)',
      'Borin Ironvow challenged Élowyn Moonwhisper to a duel',
      'Borin Ironvow defeated Élowyn Moonwhisper in a duel',
      'Reached level 12',
    ]);
    expect(channelLabels(story).get('@items')).toBe('Trades and items');
  });

  it('search the long text of a line too', () => {
    expect(found({ text: 'old mill' })).toEqual(['Read “A Weathered Plaque”']);
  });

  it('keep letters out of the roleplay types, as whispers are', () => {
    expect(RP_TYPES).not.toContain('MAIL');
    expect(RP_TYPES).not.toContain('WHISPER');
    expect(RP_TYPES).toContain('TRADE');
    expect(found({ types: RP_TYPES }).some((text) => text.startsWith('Sent a letter'))).toBe(false);
    expect(found({ channels: ['@mail'] }).some((text) => text.startsWith('Sent a letter'))).toBe(true);
  });

  it('but not outside the period, the character or the search', () => {
    expect(found({ from: 1898622251 })).not.toContain('Note: The bargain');
    expect(found({ owners: ['Dorn Placeholder'] })).not.toContain('Note: The bargain');
    expect(found({ text: 'well met' })).toEqual(['Well met, "traveller".']);
  });

  it('search roleplay names', () => {
    expect(found({ text: 'ironvow' })).toContain("I'm waiting in Goldshire.");
  });

  it('count places within the chosen period', () => {
    const { places } = computeFacets(story, { owners: [], from: null, to: null }, createClock('UTC').day);
    expect(places.get('Stormwind City')).toBe(19);
    expect(places.get('Stormwind City › Cathedral Square')).toBe(15);
    expect(places.get('Stormwind City › Trade District')).toBe(4);
    expect(places.get('The Stockade')).toBe(3);
  });

  it('count dice as roleplay', () => {
    expect(found({ types: RP_TYPES })).toContain('Borin Fixture rolls 57 (1-100)');
  });
});
