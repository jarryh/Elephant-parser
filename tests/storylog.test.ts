import { describe, expect, it } from 'vitest';
import { NotLogFileError } from '../src/shared/document';
import { parseElephant } from '../src/shared/elephant';
import { channelLabels } from '../src/shared/filter';
import { parseLua } from '../src/shared/lua';
import { parseLog } from '../src/shared/parse';
import { placeDetails, placeKeys, placeName } from '../src/shared/places';
import { NewerStoryLogError, parseStoryLog } from '../src/shared/storylog';
import { FIXTURE, referenceParse, STORYLOG, STORYLOG_CRLF, toPlain } from './helpers';
import { auditStoryLog } from './storylogAudit';

const doc = parseStoryLog(STORYLOG);
const line = (text: string) => doc.items.find((item) => item.text.includes(text))!;
const placeOf = (text: string) => doc.places![line(text).place!]!;

/** A file with one session, holding the given Lua for its lists. */
const session = (body: string) =>
  `StoryLogDB = { version = 1, sessions = { { id = "s", character = "Ann Test", started = 5, ${body} } } }`;

describe('parseLog', () => {
  it('reads both formats', () => {
    expect(parseLog(FIXTURE)).toEqual(parseElephant(FIXTURE));
    expect(parseLog(STORYLOG)).toEqual(doc);
  });

  it('rejects other addons', () => {
    expect(() => parseLog('OtherDB = {}')).toThrow(NotLogFileError);
    expect(() => parseLog('StoryLogDB = nil')).toThrow(NotLogFileError);
  });

  it('accepts a file that has no sessions yet', () => {
    expect(parseLog('StoryLogDB = { version = 1, sessions = {} }').items).toEqual([]);
  });

  it('does not guess at a newer version of the format', () => {
    expect(() => parseLog('StoryLogDB = { version = 2 }')).toThrow(NewerStoryLogError);
  });
});

describe('parseStoryLog', () => {
  it('agrees with a reference parser on what the addon writes', () => {
    expect(toPlain(parseLua(STORYLOG).get('StoryLogDB')!)).toEqual(referenceParse(STORYLOG));
  });

  it('finds every session, message and marker', () => {
    expect([...new Set(doc.logs.map((log) => log.owner))]).toEqual(['Élowyn Testwood', 'Dorn Placeholder']);
    expect(doc.items.filter((item) => item.kind === 'message')).toHaveLength(20);
    expect(doc.items.filter((item) => item.kind === 'marker').map((item) => item.text)).toEqual([
      'Note: The bargain',
      '14 messages hidden by the game',
    ]);
    expect(doc.gameVersion).toBe(16001);
  });

  it.each([
    ['Well met', 'SAY', '#4', 'Élowyn Testwood'],
    ['bows', 'EMOTE', '#4', 'Borin Fixture'],
    ['waves at you', 'TEXT_EMOTE', '#4', 'Borin Fixture'],
    ['You wave back', 'TEXT_EMOTE', '#4', 'Élowyn Testwood'],
    ['rolls 57', 'ROLL', '#4', 'Borin Fixture'],
    ['gates open', 'MONSTER_YELL', '#5', 'Gatekeeper Dummy'],
    ['Straw Golem creaks ominously.', 'MONSTER_EMOTE', '#4', 'Straw Golem'],
    ['private secret', 'WHISPER', '#1', 'Cedra Mock'],
    ['battle net', 'BN_WHISPER', '#1', 'Battle.net friend'],
    ['red door', 'CHANNEL', 'general', 'Cedra Mock'],
    ['Goldshire.', 'PARTY_LEADER', '#3', 'Borin Fixture'],
    ['evening all', 'GUILD', '#7', 'Dorn Placeholder'],
  ])('reads %j like Elephant would', (text, type, channel, sender) => {
    expect(line(text)).toMatchObject({ type, channels: [channel], sender });
  });

  it('labels the channels as Elephant does', () => {
    const labels = channelLabels(doc);
    expect([labels.get('#4'), labels.get('#1'), labels.get('general')]).toEqual(['Say', 'Whisper', 'General']);
  });

  it.each([
    ['General - Dun Morogh', 'general', 'General'],
    ['Trade (Services) - Stormwind City', 'trade (services)', 'Trade (Services)'],
    ['Trade (Local) - Stormwind City', 'trade (local) - stormwind city', 'Trade (Local) - Stormwind City'],
    ['OOC - Testville', 'ooc - testville', 'OOC - Testville'],
  ])('keys the channel %j as Elephant does', (name, channel, label) => {
    const parsed = parseLog(session(`messages = { { t = 9, e = "CHANNEL", m = "hi", ch = "${name}" } }`));
    expect(parsed.logs).toMatchObject([{ channel, label }]);
  });

  it('keeps who said it: roleplay name, class colour, language, flag and target', () => {
    expect(line('Well met')).toMatchObject({
      rpName: 'Élowyn Moonwhisper',
      color: '#f48cba',
      self: true,
      target: 'Borin Ironvow',
    });
    expect(line('Kor ma dun')).toMatchObject({ language: 'Gnomish' });
    expect(line('Kor ma dun').rpName).toBeUndefined();
    expect(line('red door')).toMatchObject({ flag: 'NEWCOMER', channelName: 'General - Stormwind City' });
    expect(doc.speakers![line('gates open').speaker!]).toMatchObject({ npc: true, npcId: 90001 });
  });

  it('keeps where it was said', () => {
    expect(placeOf('Well met')).toMatchObject({ map: 1453, x: 0.5234, y: 0.6712, wx: -8834.2, indoors: false });
    expect(placeName(placeOf('Well met'))).toBe('Stormwind City, Cathedral Square');
    expect(placeName(placeOf('new evening'))).toBe("Elwynn Forest, Goldshire, Lion's Pride Inn");
  });

  it('keeps the speaker apart from the recorder, for group members', () => {
    const item = line("I'm waiting");
    expect(placeOf("I'm waiting").zone).toBe('Stormwind City');
    expect(doc.places![item.speakerPlace!]).toMatchObject({ zone: 'Elwynn Forest', map: 1429, x: 0.417 });
    expect(line('Kor ma dun').speakerPlace).toBeUndefined();
  });

  it('has names but no coordinates inside a dungeon', () => {
    const place = placeOf('Dark in here');
    expect(placeName(place)).toBe('The Stockade');
    expect(place.x).toBeUndefined();
    expect(placeDetails(place)).toBe('no coordinates · indoors');
  });

  it('does not mistake whom a whisper went to for the one who sent it', () => {
    const parsed = parseLog(
      session('speakers = { { name = "Bo Test" } }, messages = { { t = 9, e = "WHISPER_INFORM", m = "hi", s = 1 } }'),
    );
    expect(parsed.items[0]).toMatchObject({ sender: 'Bo Test' });
    expect(parsed.items[0]!.self).toBeUndefined();
  });

  it('drops your own realm from names, as Elephant does', () => {
    const parsed = parseLog(
      'StoryLogDB = { sessions = { { id = "r", character = "Ann-Home", realm = "Home", interface = 120105,' +
        ' speakers = { { name = "Ann-Home" }, { name = "Bo-Away" } },' +
        ' messages = { { t = 1, e = "SAY", m = "a", s = 1 }, { t = 2, e = "SAY", m = "b", s = 2 } } } } }',
    );
    expect(parsed.items.map((item) => item.sender)).toEqual(['Ann', 'Bo-Away']);
    expect(parsed.items[0]!.self).toBe(true);
  });

  it("makes other players' names one plain line", () => {
    const parsed = parseLog(
      session(
        'speakers = { { name = "Bo Test", rp = "|cffff0000Red|r\\nBo" } }, messages = { { t = 9, e = "SAY", m = "hi", s = 1 } }',
      ),
    );
    expect(parsed.items[0]!.rpName).toBe('Red Bo');
  });

  it('survives indexes that point nowhere and impossible coordinates', () => {
    const parsed = parseLog(
      session('places = { { x = 7, y = -1, zone = "Z" } }, messages = { { t = 9, e = "SAY", m = "hi", s = 4, p = 9, sp = 1 } }'),
    );
    expect(parsed.items[0]).toMatchObject({ sender: null, speakerPlace: 0 });
    expect(parsed.items[0]!.place).toBeUndefined();
    expect(parsed.places).toEqual([{ zone: 'Z' }]);
  });

  it('follows explicit keys, whatever their order', () => {
    const parsed = parseLog(
      session(
        'speakers = { [2] = { name = "Second" }, [1] = { name = "First" } },' +
          ' messages = { [1] = { t = 9, e = "SAY", m = "hi", s = 2 } }',
      ),
    );
    expect(parsed.items[0]!.sender).toBe('Second');
  });

  it.each([
    ['LF', STORYLOG],
    ['CRLF', STORYLOG_CRLF],
  ])('records positions that point at whole entries (%s)', (_name, source) => {
    const lines = source.split(/\r?\n/);
    for (const entry of parseLog(source).entries) {
      expect(source.slice(entry.start, entry.end)).toMatch(/^\{[\s\S]*\},$/);
      expect(lines[entry.startLine - 1]).toBe('{');
      expect(lines[entry.endLine - 1]).toBe('},');
    }
  });
});

describe('places', () => {
  it('count for their zone and for themselves', () => {
    expect(placeKeys(placeOf('Well met'))).toEqual(['Stormwind City', 'Stormwind City › Cathedral Square']);
    expect(placeKeys(placeOf('Dark in here'))).toEqual(['The Stockade']);
    expect(placeKeys({})).toEqual([]);
  });

  it('name a house by its neighbourhood', () => {
    expect(placeName({ zone: 'Founders Point', neighborhood: 'Razorwind', house: 'The Burrow' })).toBe(
      'Founders Point, Razorwind, The Burrow',
    );
  });
});

describe('StoryLog item IDs', () => {
  const ids = doc.items.map((item) => item.id);

  it('are unique, with identical lines kept apart', () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.items.filter((item) => item.text === 'Again')).toHaveLength(2);
  });

  it('do not depend on line endings', () => {
    expect(parseLog(STORYLOG_CRLF).items.map((item) => item.id)).toEqual(ids);
  });

  it('survive old sessions being pruned', () => {
    const list = '["sessions"] = {\n';
    const from = STORYLOG.indexOf(list) + list.length;
    const pruned = STORYLOG.slice(0, from) + STORYLOG.slice(STORYLOG.indexOf('{\n["id"] = "1898713700'));
    const after = parseLog(pruned).items.map((item) => item.id);
    expect(after).toHaveLength(4);
    expect(after).toEqual(ids.slice(-4));
  });

  it('survive a profile that arrived late, and a growing count of hidden lines', () => {
    const changed = STORYLOG.replaceAll('Borin Ironvow', 'Someone Else').replace('["n"] = 14', '["n"] = 15');
    expect(parseLog(changed).items.map((item) => item.id)).toEqual(ids);
  });
});

describe('the checks for a real file', () => {
  const audit = (source: string) => auditStoryLog(Buffer.from(source, 'utf8'));
  const clean = { misplaced: 0, undated: 0, dangling: 0, dropped: 0, badCuts: 0 };

  /** One session as WoW lays it out, with the given fields in its only line. */
  const written = (fields: string[], lists: string[] = []) =>
    [
      'StoryLogDB = {',
      '["sessions"] = {',
      '{',
      '["id"] = "s",',
      '["character"] = "Ann Test",',
      ...lists,
      '["messages"] = {',
      '{',
      '["e"] = "SAY",',
      '["m"] = "hi",',
      ...fields,
      '},',
      '},',
      '},',
      '},',
      '}',
      '',
    ].join('\r\n');
  const places = ['["places"] = {', '{', '["zone"] = "Z",', '},', '},'];
  const speakers = (about: string) => ['["speakers"] = {', '{', about, '},', '},'];
  const lists = [...places, ...speakers('["name"] = "Bo Test",')];

  it('pass what the addon writes', () => {
    expect(audit(STORYLOG_CRLF)).toEqual({
      ...clean,
      utf8: true,
      sameAsReference: true,
      lines: 22,
      entries: 22,
      items: 22,
      typesInFile: 14,
      types: 14,
      charactersInFile: 2,
      owners: 2,
      unchanged: true,
    });
  });

  it('pass a line whose references are all there', () => {
    const fields = ['["t"] = 5,', '["p"] = 1,', '["sp"] = 1,', '["s"] = 1,', '["to"] = 1,'];
    expect(audit(written(fields, lists))).toMatchObject({ ...clean, lines: 1, items: 1, unchanged: true });
  });

  it.each(['p', 'sp', 's', 'to'])('notice a %s that points at nothing', (key) => {
    expect(audit(written(['["t"] = 5,', `["${key}"] = 9,`], lists))).toMatchObject({ ...clean, dangling: 1, dropped: 1 });
  });

  it('notice a speaker without a name', () => {
    const nameless = [...places, ...speakers('["class"] = "MAGE",')];
    expect(audit(written(['["t"] = 5,', '["s"] = 1,'], nameless))).toMatchObject({ dangling: 2, dropped: 1 });
  });

  it('notice a line without a time', () => {
    expect(audit(written([]))).toMatchObject({ ...clean, undated: 1 });
  });

  it('notice entries that are not on lines of their own', () => {
    expect(audit(session('messages = { { t = 5, e = "SAY", m = "hi" } }')).misplaced).toBe(1);
  });

  it('notice bytes that are not UTF-8', () => {
    const bytes = Buffer.from(written(['["t"] = 5,']), 'utf8');
    expect(auditStoryLog(bytes).utf8).toBe(true);
    bytes[bytes.indexOf('hi')] = 0xff;
    expect(auditStoryLog(bytes).utf8).toBe(false);
  });
});
