import { describe, expect, it } from 'vitest';
import {
  fillColours,
  fitView,
  gridLines,
  groupDots,
  mapChoices,
  mapDots,
  placeLabels,
  speakerTally,
} from '../src/shared/mapData';
import { parseLog } from '../src/shared/parse';
import { STORYLOG } from './helpers';

const { items, places: all } = parseLog(STORYLOG);
const places = all!;
/** The last session of the fixture is a day on the road, with its own tests below. */
const ROAD = 1898900000;
const messages = items.filter((item) => item.kind === 'message' && item.at < ROAD);
const road = items.filter((item) => item.kind === 'message' && item.at > ROAD);
const city = mapDots(messages, places, 1453);

describe('the map', () => {
  it('offers the maps that have lines, the busiest first', () => {
    expect(mapChoices(messages, places)).toEqual([
      { map: 1453, name: 'Stormwind City', lines: 10 },
      { map: 1429, name: 'Elwynn Forest', lines: 2 },
    ]);
  });

  it('puts a dot exactly where you or a group member stood', () => {
    expect(city.find((dot) => dot.speaker === 'Borin Fixture')).toMatchObject({ exact: true, x: 0.5262 });
    expect(city.find((dot) => dot.speaker === 'Élowyn Testwood')).toMatchObject({ exact: true });
  });

  it('shows a stranger only as heard from where you stood', () => {
    expect(city.find((dot) => dot.speaker === 'Cedra Mock')).toMatchObject({ exact: false, x: 0.5234 });
  });

  it('leaves out guild chat, whispers and channels, which reach you anywhere', () => {
    const speakers = city.map((dot) => dot.speaker);
    expect(speakers).not.toContain('Dorn Placeholder');
    expect(speakers).not.toContain('Battle.net friend');
    // Cedra said one thing aloud, whispered once and wrote in General once.
    expect(city.filter((dot) => dot.speaker === 'Cedra Mock').flatMap((dot) => dot.items)).toHaveLength(1);
  });

  it('draws a quest where you stood when you took it', () => {
    const quest = city.find((dot) => dot.items.some((item) => item.type === 'QUEST_ACCEPTED'))!;
    expect(quest).toMatchObject({ exact: true, speaker: 'Élowyn Testwood', x: 0.5234 });
    // Handed in inside a dungeon, where the game gives no position.
    expect(messages.filter((item) => item.type === 'QUEST_TURNED_IN')).toHaveLength(1);
    expect(mapDots(messages, places, 1429).flatMap((dot) => dot.items).some((item) => item.quest)).toBe(false);
  });

  it('draws party chat only where its speaker is known to be', () => {
    const said = messages.find((item) => item.text.includes('Kor ma dun'))!;
    const inParty = { ...said, type: 'PARTY' };
    expect(mapDots([said], places, 1453)).toHaveLength(1);
    expect(mapDots([inParty], places, 1453)).toEqual([]);
    expect(mapDots([{ ...inParty, self: true }], places, 1453)).toMatchObject([{ exact: true }]);
    expect(mapDots([{ ...inParty, speakerPlace: said.place }], places, 1453)).toMatchObject([{ exact: true }]);
  });

  it('draws a group member on their own map', () => {
    const elwynn = mapDots(messages, places, 1429);
    expect(elwynn.find((dot) => dot.speaker === 'Borin Fixture')).toMatchObject({ exact: true, x: 0.417 });
  });

  it('fans out speakers who share a spot', () => {
    const shared = groupDots(city, fitView(city)).filter((dot) => dot.x === 0.5234);
    expect(shared.length).toBeGreaterThan(1);
    expect(shared.map((dot) => dot.nth)).toEqual(shared.map((_, n) => n));
    expect(shared.every((dot) => dot.of === shared.length)).toBe(true);
  });

  it('draws spots that are too close to tell apart as one', () => {
    const walk = Array.from({ length: 1000 }, (_, n) => ({ ...city[0]!, key: String(n), x: 0.3 + n / 100000, y: 0.5 }));
    const drawn = groupDots(walk, { left: 0, top: 0, size: 1 });
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.items).toHaveLength(1000 * city[0]!.items.length);
    expect(city[0]!.items.length).toBeLessThan(5);
  });

  it('counts every line once', () => {
    expect(speakerTally(city).reduce((sum, person) => sum + person.lines, 0)).toBe(10);
  });

  it('zooms to the dots without leaving the map', () => {
    const view = fitView(city);
    expect(view.size).toBeLessThan(0.05);
    for (const { x, y } of city) {
      expect(x).toBeGreaterThanOrEqual(view.left);
      expect(x).toBeLessThanOrEqual(view.left + view.size);
      expect(y).toBeGreaterThanOrEqual(view.top);
      expect(y).toBeLessThanOrEqual(view.top + view.size);
    }
    expect(fitView([{ x: 0, y: 1 }])).toMatchObject({ left: 0, top: 1 - fitView([{ x: 0, y: 1 }]).size });
    expect(fitView([])).toEqual({ left: 0, top: 0, size: 1 });
  });

  it('counts the grid from 0 to 100, as the game does', () => {
    expect(gridLines({ left: 0, top: 0, size: 1 }).x.map((line) => line.label)).toEqual(['20', '40', '60', '80']);
  });

  it('names the subzone above its dots', () => {
    expect(placeLabels(city, places, fitView(city), 1200, 800).map((label) => label.text)).toEqual(['Cathedral Square']);
  });

  it('draws what happened where the recorder was, and an NPC in a dialogue around there', () => {
    const goldshire = mapDots(road, places, 1429);
    const trade = goldshire.find((dot) => dot.items.some((item) => item.type === 'TRADE'))!;
    expect(trade).toMatchObject({ exact: true, speaker: 'Élowyn Testwood', x: 0.417 });
    expect(goldshire.find((dot) => dot.speaker === 'Innkeeper Farley')).toMatchObject({ exact: false, npc: true });
    expect(mapDots(road, places, 1453).flatMap((dot) => dot.items.map((item) => item.type))).toEqual(
      expect.arrayContaining(['TRAVEL', 'MAIL']),
    );
  });

  it('draws a duel or an invitation as the recorder’s, not as the other one standing near', () => {
    const goldshire = mapDots(road, places, 1429);
    const duels = goldshire.filter((dot) => dot.items.some((item) => item.type === 'DUEL'));
    expect(duels).toMatchObject([{ exact: true, speaker: 'Élowyn Testwood', name: 'Élowyn Moonwhisper' }]);
    // Borin's dots are what he said, not the duel he won.
    const borin = goldshire.filter((dot) => dot.speaker === 'Borin Fixture').flatMap((dot) => dot.items.map((item) => item.type));
    expect(borin).toEqual(['SAY', 'PARTY']);
  });
});

describe('map colours', () => {
  const people = [
    { key: 'Ann', npc: false },
    { key: 'Guard', npc: true },
    { key: 'Bo', npc: false },
  ];

  it('go to the busiest players when nobody in view has one', () => {
    expect(fillColours([null, null, null], people)).toEqual(['Ann', 'Bo', null]);
    expect(fillColours(['Cy', null, 'Di'], people)).toEqual(['Ann', 'Bo', null]);
  });

  it('stay as they are while anyone in view has one', () => {
    const coloured = ['Cy', 'Bo', null];
    expect(fillColours(coloured, people)).toBe(coloured);
  });

  it('stay as they are when there is nobody to give them to', () => {
    const coloured = ['Cy', null, null];
    expect(fillColours(coloured, [])).toBe(coloured);
    expect(fillColours(coloured, [{ key: 'Guard', npc: true }])).toBe(coloured);
  });
});
