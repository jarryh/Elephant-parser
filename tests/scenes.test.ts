import { describe, expect, it } from 'vitest';
import { parseElephant } from '../src/shared/elephant';
import { createMatcher, NO_FILTERS } from '../src/shared/filter';
import { parseLog } from '../src/shared/parse';
import { computeScenes, SCENE_GAP, SCENE_RADIUS } from '../src/shared/scenes';
import type { LogItem, Place } from '../src/shared/types';
import { FIXTURE, STORYLOG } from './helpers';

let nextId = 0;
const line = (at: number, place?: number, patch: Partial<LogItem> = {}): LogItem => ({
  id: String(++nextId),
  kind: 'message',
  owner: 'Ann Test',
  channels: ['#4'],
  time: at,
  at,
  type: 'SAY',
  raw: 'hi',
  text: 'hi',
  sender: 'Bo Test',
  place,
  ...patch,
});

/** On one map, the given yards north of each other. */
const along = (...yards: number[]): Place[] => yards.map((wx) => ({ map: 1, zone: 'Z', wx, wy: 0, cont: 0 }));
const sizes = (items: LogItem[], places: Place[] = []) => computeScenes(items, places).map((scene) => scene.lines);

describe('computeScenes', () => {
  it('starts a new scene after a gap', () => {
    expect(sizes([line(0), line(SCENE_GAP), line(2 * SCENE_GAP + 1)])).toEqual([2, 1]);
  });

  it('starts a new scene out of earshot of where it began, not of the last line', () => {
    const places = along(0, SCENE_RADIUS * 0.7, SCENE_RADIUS * 1.4);
    expect(sizes([line(0, 0), line(1, 1), line(2, 2)], places)).toEqual([2, 1]);
  });

  it('starts a new scene on another map', () => {
    const places = [...along(0), { map: 2, zone: 'Y', wx: 1, wy: 0, cont: 0 }];
    expect(sizes([line(0, 0), line(1, 1)], places)).toEqual([1, 1]);
  });

  it('starts a new scene on another continent, however close the numbers', () => {
    const places = [...along(0), { map: 1, zone: 'Z', wx: 1, wy: 0, cont: 1 }];
    expect(sizes([line(0, 0), line(1, 1)], places)).toEqual([1, 1]);
  });

  it('falls back to the zone without maps or distances', () => {
    const places = [{ zone: 'A' }, { zone: 'A', sub: 'Inn' }, { zone: 'B' }];
    expect(sizes([line(0, 0), line(1, 1), line(2, 2)], places)).toEqual([2, 1]);
  });

  it('keeps party chat on a journey in one scene', () => {
    const items = [0, 1, 2].map((n) => line(n, n, { type: 'PARTY' }));
    expect(sizes(items, along(0, 900, 5000))).toEqual([3]);
  });

  it('but splits it at a dungeon', () => {
    const places = [...along(0), { zone: 'Cave', inst: 'Cave' }];
    expect(sizes([line(0, 0, { type: 'PARTY' }), line(1, 1, { type: 'PARTY' })], places)).toEqual([1, 1]);
  });

  it('splits at the door of a house', () => {
    const places = [{ zone: 'Z' }, { zone: 'Z', house: 'The Burrow' }];
    expect(sizes([line(0, 0), line(1, 1)], places)).toEqual([1, 1]);
  });

  it('keeps each character apart', () => {
    expect(sizes([line(0), line(1, undefined, { owner: 'Cy Test' }), line(2)])).toEqual([2, 1]);
  });

  it('leaves out other chat and NPCs talking to nobody', () => {
    const items = [line(0, undefined, { type: 'GUILD' }), line(1, undefined, { type: 'MONSTER_YELL' })];
    expect(computeScenes(items)).toEqual([]);
  });

  const npc = (at: number, place?: number) => line(at, place, { type: 'MONSTER_SAY', sender: 'Guard' });

  it('does not let an NPC keep a scene going', () => {
    expect(sizes([line(0), npc(SCENE_GAP), line(2 * SCENE_GAP)])).toEqual([1, 1]);
  });

  it('does not let an NPC start a scene, or end one late', () => {
    const scenes = computeScenes([npc(0), line(10), npc(20)]);
    expect(scenes).toMatchObject([{ from: 10, to: 10, lines: 1, participants: [{ name: 'Bo Test' }] }]);
    expect(scenes[0]!.ids).toHaveLength(1);
  });

  it('counts an NPC who speaks in the middle of a scene', () => {
    expect(computeScenes([line(0), npc(5), line(10)])).toMatchObject([
      { lines: 3, participants: [{ name: 'Bo Test', lines: 2 }, { name: 'Guard', npc: true }] },
    ]);
  });

  it('does not let an NPC far away split a talk in party chat', () => {
    const items = [line(0, 0), npc(1, 1), line(2, 1, { type: 'PARTY' })];
    expect(sizes(items, along(0, 900))).toEqual([3]);
  });

  it('is named by a note, even one written before it begins', () => {
    const note = line(0, undefined, { kind: 'marker', type: 'NOTE', text: 'Note: The duel', sender: null });
    expect(computeScenes([note, line(5)])).toMatchObject([{ id: note.id, name: 'The duel', from: 0, to: 5, lines: 1 }]);
  });
});

describe('scenes of a StoryLog file', () => {
  const doc = parseLog(STORYLOG);
  const scenes = computeScenes(doc.items, doc.places);

  it('split at the dungeon, the evening and the character', () => {
    expect(scenes.map(({ place, lines }) => [place, lines])).toEqual([
      ['Stormwind City, Cathedral Square', 10],
      ['The Stockade', 2],
      ["Elwynn Forest, Goldshire, Lion's Pride Inn", 1],
      ['Dun Morogh', 3],
    ]);
  });

  it('say who talked, by roleplay name', () => {
    expect(scenes[0]!.name).toBe('The bargain');
    expect(scenes[0]!.participants).toEqual([
      { name: 'Borin Ironvow', lines: 4, npc: false },
      { name: 'Élowyn Moonwhisper', lines: 3, npc: false },
      { name: 'Cedra Mock', lines: 1, npc: false },
      { name: 'Gatekeeper Dummy', lines: 1, npc: true },
      { name: 'Straw Golem', lines: 1, npc: true },
    ]);
  });

  it('can be selected with the existing character and period filters', () => {
    const { owner, from, to, ids } = scenes[0]!;
    const matched = doc.items.filter(createMatcher({ ...NO_FILTERS, owners: [owner], from, to }, doc.places));
    for (const id of ids) expect(matched.map((item) => item.id)).toContain(id);
    expect(matched.map((item) => item.text)).not.toContain('Dark in here.');
  });
});

it('finds scenes in Elephant files by time alone', () => {
  const scenes = computeScenes(parseElephant(FIXTURE).items);
  expect(scenes.map((scene) => scene.owner)).toEqual(['Élowyn Testwood', 'Élowyn Testwood', 'Dorn Placeholder']);
  expect(scenes.every((scene) => scene.place === '')).toBe(true);
});
