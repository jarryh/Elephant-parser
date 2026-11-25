import { describe, expect, it } from 'vitest';
import { parseMarkup, stripMarkup } from '../src/shared/markup';
import { gameOf, linkUrl, npcUrl, zoneUrl } from '../src/shared/wowhead';
import type { LogItem, LogInfo } from '../src/shared/types';

describe('markup', () => {
  it.each([
    ['plain', 'plain'],
    ['a || b', 'a | b'],
    ['|Hplayer:Ann|h[Ann]|h waves', '[Ann] waves'],
    ['|cnIQ3:|Hitem:1:::|h[Blade]|h|r!', '[Blade]!'],
    ['icon |TInterface\\Icons\\x:16|t|A:atlas:16:16|a here', 'icon  here'],
    ['first|nsecond', 'first\nsecond'],
    ['1 |4Copper:Coppers;', '1 Copper'],
    ['12 |4Copper:Coppers;', '12 Coppers'],
    ['from |Kq12|k', 'from [hidden]'],
    ['a lone | pipe', 'a lone | pipe'],
  ])('reads %j as %j', (raw, text) => {
    expect(stripMarkup(raw)).toBe(text);
  });

  it('keeps colours, including nested and named ones', () => {
    expect(parseMarkup('a |cffFF0000red |cnIQ2:green|r red|r b')).toEqual([
      { text: 'a ' },
      { text: 'red ', color: '#ff0000' },
      { text: 'green', color: '#1eff00' },
      { text: ' red', color: '#ff0000' },
      { text: ' b' },
    ]);
  });

  it('never passes an unknown colour name through as a colour', () => {
    expect(parseMarkup('|cnurl(evil):text|r')).toEqual([{ text: 'text' }]);
  });
});

describe('links', () => {
  it.each([
    ['|Hitem:19221::::::::1:1486:::::::::|h[Wine]|h', 'item=19221'],
    ['|Hquest:278:0|h[Quest]|h', 'quest=278'],
    ['|Hspell:1152:0|h[Purify]|h', 'spell=1152'],
    ['|Henchant:13637|h[Enchant]|h', 'spell=13637'],
    ['|Hachievement:6:Player-1-A:1|h[Level 10]|h', 'achievement=6'],
    ['|Htrade:Player-1-0000000A:7413:333|h[Enchanting]|h', 'spell=7413'],
    ['|Hplayer:Ann|h[Ann]|h', undefined],
    ['|Hitem:12x|h[Odd]|h', undefined],
    ['|Hitem:../../evil|h[Evil]|h', undefined],
  ])('reads the target of %j', (raw, link) => {
    expect(parseMarkup(raw)[0]!.link).toBe(link);
  });

  it('end where the link ends', () => {
    expect(parseMarkup('see |cff0070dd|Hitem:5:::|h[Blade]|h|r now')).toEqual([
      { text: 'see ' },
      { text: '[Blade]', color: '#0070dd', link: 'item=5' },
      { text: ' now' },
    ]);
  });
});

describe('Wowhead', () => {
  const logs = (...owners: string[]) => owners.map((owner) => ({ owner }) as LogInfo);

  it('tells the game from the version, or from how Elephant names characters', () => {
    expect(gameOf({ gameVersion: 16001, logs: [] })).toBe('forever');
    expect(gameOf({ gameVersion: 120105, logs: [] })).toBe('retail');
    expect(gameOf({ logs: logs('Ann Vale', 'Alliance - Testrealm (shared)') })).toBe('forever');
    expect(gameOf({ logs: logs('Ann - Testrealm') })).toBe('retail');
  });

  it("links to that game's database", () => {
    expect(linkUrl('forever', 'item=5')).toBe('https://www.wowhead.com/forever/item=5');
    expect(linkUrl('retail', 'item=5')).toBe('https://www.wowhead.com/item=5');
  });

  it('links a zone by ID, and a dungeon by name', () => {
    expect(zoneUrl('forever', { map: 1429, zone: 'Elwynn Forest' })).toBe('https://www.wowhead.com/forever/zone=12');
    expect(zoneUrl('forever', { inst: 'The Stockade' })).toBe('https://www.wowhead.com/forever/search?q=The%20Stockade');
    expect(zoneUrl('retail', { map: 84, zone: 'A&B' })).toBe('https://www.wowhead.com/search?q=A%26B');
    expect(zoneUrl('forever', {})).toBeNull();
  });

  it('looks up NPCs, never players', () => {
    const line = (type: string) => ({ type, sender: 'Some One', speaker: 0 }) as LogItem;
    expect(npcUrl('forever', line('MONSTER_SAY'), [{ name: 'Some One', npcId: 466 }])).toMatch(/\/forever\/npc=466$/);
    expect(npcUrl('forever', line('MONSTER_SAY'))).toMatch(/search\?q=Some%20One$/);
    expect(npcUrl('forever', line('SAY'))).toBeNull();
  });
});
