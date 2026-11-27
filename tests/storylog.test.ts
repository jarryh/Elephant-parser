import { describe, expect, it } from 'vitest';
import { NotLogFileError } from '../src/shared/document';
import { parseElephant } from '../src/shared/elephant';
import { exportLua } from '../src/shared/export';
import { channelLabels, NO_FILTERS } from '../src/shared/filter';
import { parseLua } from '../src/shared/lua';
import { parseMarkup } from '../src/shared/markup';
import { parseLog } from '../src/shared/parse';
import { placeDetails, placeKeys, placeName } from '../src/shared/places';
import { computeSelection } from '../src/shared/selection';
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
    expect(doc.items.filter((item) => item.kind === 'message')).toHaveLength(42);
    expect(doc.items.filter((item) => item.kind === 'marker').map((item) => item.text)).toEqual([
      'In a party with Borin Ironvow',
      'Note: The bargain',
      '14 messages hidden by the game',
      'Joined a party with Borin Ironvow, led by Élowyn Moonwhisper',
      'Note: Into Westfall',
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

describe('the group', () => {
  it('is on every line from where it was saved to the end of the session', () => {
    expect(doc.groups![0]).toEqual({ members: [0] });
    expect(doc.speakers![0]).toMatchObject({ name: 'Borin Fixture', rp: 'Borin Ironvow' });
    const [first, second] = [
      [0, 1898622800],
      [1898622800, 1898714000],
    ].map(([from, to]) => doc.items.filter((item) => item.owner === 'Élowyn Testwood' && item.at > from! && item.at <= to!));
    expect(first!.every((item) => item.group === 0)).toBe(true);
    expect(first).toHaveLength(21);
    // Nothing carries over to the next login.
    expect(second!.map((item) => item.group)).toEqual([undefined]);
  });

  const grouped = (messages: string) =>
    parseStoryLog(
      session(`speakers = { { name = "Bo Test" }, { name = "Cy Test", rp = "Cyrus" } }, messages = { ${messages} }`),
    );

  it.each([
    ['{ t = 5, e = "GROUP", g = { 1, 2 } }', 'In a party with Bo Test and Cyrus', { members: [0, 1] }],
    ['{ t = 5, e = "GROUP", g = { 2 }, raid = true }', 'In a raid with Cyrus (2)', { members: [1], raid: true }],
    // A member that the file does not know is left out.
    ['{ t = 5, e = "GROUP", g = { 1, 9 } }', 'In a party with Bo Test', { members: [0] }],
    // Not saved at login, so the group formed then.
    ['{ t = 60, e = "GROUP", g = { 1 } }', 'Joined a party with Bo Test', { members: [0] }],
  ])('reads %s', (message, text, group) => {
    const read = grouped(`${message}, { t = 70, e = "SAY", m = "hi", s = 1 }`);
    expect(read.items.map((item) => [item.kind, item.text, item.group])).toEqual([
      ['marker', text, 0],
      ['message', 'hi', 0],
    ]);
    expect(read.groups).toEqual([group]);
  });

  it('ends when you leave, and is one entry when you join the same people again', () => {
    const read = grouped(
      '{ t = 5, e = "GROUP", g = { 1 } }, { t = 20, e = "GROUP", g = {} }, { t = 30, e = "SAY", m = "alone", s = 1 },' +
        ' { t = 40, e = "GROUP", g = { 1 } }',
    );
    expect(read.items.map((item) => [item.text, item.group])).toEqual([
      ['In a party with Bo Test', 0],
      ['Left the group', undefined],
      ['alone', undefined],
      ['Joined a party with Bo Test', 0],
    ]);
    expect(read.groups).toHaveLength(1);
  });

  it('says who joined and who left, and who leads', () => {
    const read = parseStoryLog(
      session(
        'speakers = { { name = "Bo Test" }, { name = "Cy Test", rp = "Cyrus" }, { name = "Di Test" }, { name = "Ann Test" } }, ' +
          'messages = { { t = 5, e = "GROUP", g = { 1 }, lead = 4 }, { t = 20, e = "GROUP", g = { 1, 2, 3 }, lead = 4 }, ' +
          '{ t = 30, e = "GROUP", g = { 2, 3 }, raid = true, lead = 2 }, { t = 40, e = "GROUP", g = {}, why = "disbanded" } }',
      ),
    );
    expect(read.items.map((item) => item.text)).toEqual([
      'In a party with Bo Test, led by Ann Test',
      'Cyrus and Di Test joined. Party, led by Ann Test: Bo Test, Cyrus, Di Test',
      'Bo Test left, the party became a raid, Cyrus now leads. Raid (3): Cyrus (leader), Di Test',
      'The group was disbanded',
    ]);
    expect(read.groups![2]).toEqual({ members: [1, 2], raid: true, leader: 1 });
  });

  it('is not someone leaving and joining when only their roleplay name changed', () => {
    const read = parseStoryLog(
      session(
        'speakers = { { name = "Bo Test", rp = "Bo" }, { name = "Bo Test", rp = "Hooded Figure" } }, ' +
          'messages = { { t = 5, e = "GROUP", g = { 1 } }, { t = 20, e = "GROUP", g = { 2 } } }',
      ),
    );
    expect(read.items.map((item) => item.text)).toEqual(['In a party with Bo', 'Party: Hooded Figure']);
  });
});

describe('what happened', () => {
  const people = 'speakers = { { name = "Bo Test" }, { name = "Cy|Test", rp = "Cy" }, { name = "Ann Test", sex = 3 } }';
  const read = (message: string) => parseStoryLog(session(`${people}, messages = { ${message} }`)).items[0]!;

  it.each([
    ['{ e = "INVITE", k = "out", s = 3, to = 1 }', 'Invited Bo Test to the group'],
    ['{ e = "INVITE", k = "in", s = 1 }', 'Bo Test invited you to a group'],
    ['{ e = "INVITE", k = "declined", s = 2 }', 'Cy declined your invitation'],
    [
      '{ e = "TRADE", to = 1, a = { { link = "[Axe]", count = 2 }, { link = "[Bow]" } }, am = 10203, bm = 5 }',
      'Traded with Bo Test: gave [Axe] ×2, [Bow], 1g 2s 3c; got 5c',
    ],
    ['{ e = "TRADE" }', 'Traded with someone'],
    ['{ e = "ITEM", k = "made", m = "[Potion]", n = 3 }', 'Made [Potion] ×3'],
    ['{ e = "ITEM", k = "got", m = "[Key]" }', 'Received [Key]'],
    ['{ e = "ZONE" }', 'Moved on'],
    ['{ e = "TRAVEL", k = "summon", s = 1, m = "The Deadmines" }', 'Summoned by Bo Test to The Deadmines'],
    ['{ e = "FIGHT", n = 90 }', 'A fight (2 min)'],
    ['{ e = "FIGHT", foes = { "Thug", "Bandit", "Boss" }, n = 40 }', 'Fought Thug, Bandit and Boss (40 s)'],
    ['{ e = "ENCOUNTER", m = "Hogger", won = false, n = 3700 }', 'Fought Hogger and lost (1 h 2 min)'],
    ['{ e = "ENCOUNTER", m = "Hogger" }', 'Fought Hogger'],
    ['{ e = "DEATH" }', 'Died'],
    ['{ e = "REVIVED" }', 'Came back to life'],
    ['{ e = "DUEL", k = "fled", s = 1, to = 2 }', 'Cy fled from a duel with Bo Test'],
    ['{ e = "LEVEL" }', 'Gained a level'],
    ['{ e = "GOSSIP", m = "Greetings, $gsir:madam;. $B$BWelcome, $N." }', 'Greetings, madam.\n\nWelcome, Ann.'],
    ['{ e = "CHOICE", m = "Yes." }', 'Chose: “Yes.”'],
    ['{ e = "READ", m = "Book", n = 3 }', 'Read “Book”, page 3'],
    ['{ e = "CAST", m = "Heal", to = 1, n = 4 }', 'Cast Heal on Bo Test ×4'],
    ['{ e = "CAST", m = "Brown Horse", mount = true }', 'Mounted Brown Horse'],
    ['{ e = "OUTFIT", off = { "[Hat]" } }', 'Took off [Hat]'],
  ])('reads %s', (message, text) => {
    const item = read(message.replace('{ e', '{ t = 10, e'));
    expect(item).toMatchObject({ kind: 'message', text });
  });

  it('keeps a letter or a page in full beside the line, and leaves out the HTML of a book', () => {
    const letter = read('{ t = 10, e = "MAIL", k = "read", who = "Bo Test", m = "Hi", text = "Dear Ann,\\nhello." }');
    expect(letter).toMatchObject({ text: 'Read a letter from Bo Test: “Hi”', detail: 'Dear Ann,\nhello.', channels: ['@mail'] });
    const page = read('{ t = 10, e = "READ", m = "Plaque", text = "<HTML><BODY><H1>Here</H1><P>lies Arthur.</P></BODY></HTML>" }');
    expect(page.detail).toBe('Here\nlies Arthur.');
  });

  it('keeps narration in angle brackets, which is no HTML', () => {
    const said = read('{ t = 10, e = "GOSSIP", s = 1, m = "<The dwarf hands you a sealed letter.> Take it. <He nods.>" }');
    expect(said.text).toBe('<The dwarf hands you a sealed letter.> Take it. <He nods.>');
    const quest = read('{ t = 10, e = "QUEST_ACCEPTED", q = 7, m = "Pelts", text = "<Snarl> Bring pelts.", goal = "<Ten> pelts" }');
    expect(quest.detail).toBe('<Snarl> Bring pelts.\n\nObjective: <Ten> pelts');
    const page = read('{ t = 10, e = "READ", m = "Note", text = "<scrawled> Meet me at dawn." }');
    expect(page.detail).toBe('<scrawled> Meet me at dawn.');
  });

  it('leaves a letter as its writer wrote it', () => {
    const letter = read('{ t = 10, e = "MAIL", k = "read", who = "Bo Test", m = "Hi", text = "The $Bounty is $N. <signed> Bo" }');
    expect(letter.detail).toBe('The $Bounty is $N. <signed> Bo');
  });

  it('belongs to the recorder, whoever else it names', () => {
    const invited = read('{ t = 10, e = "INVITE", k = "in", s = 1 }');
    expect(invited).toMatchObject({ sender: 'Ann Test', self: true, speaker: 0, text: 'Bo Test invited you to a group' });
    const traded = read('{ t = 10, e = "TRADE", s = 3, to = 2 }');
    expect(traded).toMatchObject({ sender: 'Ann Test', self: true, speaker: 2, target: 'Cy', targetSpeaker: 1 });
    const back = read('{ t = 10, e = "REVIVED" }');
    expect(back).toMatchObject({ sender: 'Ann Test', self: true });
    // An NPC speaks its own line.
    const npc = parseStoryLog(session('speakers = { { name = "Guard", npc = true } }, messages = { { t = 10, e = "GOSSIP", s = 1, m = "Halt." } }'));
    expect(npc.items[0]).toMatchObject({ sender: 'Guard' });
    expect(npc.items[0]).not.toHaveProperty('self');
  });

  it('still takes its ID from whom the addon named, as saved edits are stored by ID', () => {
    const [byBo, byCy] = ['1', '2'].map((s) => read(`{ t = 10, e = "INVITE", k = "in", s = ${s} }`));
    expect(byBo!.sender).toBe(byCy!.sender);
    expect(byBo!.id).not.toBe(byCy!.id);
  });

  it("keeps a name's | from starting an escape code", () => {
    expect(read('{ t = 10, e = "DUEL", k = "won", s = 1, to = 2 }').raw).toBe('Bo Test defeated Cy in a duel');
    expect(read('{ t = 10, e = "INVITE", k = "out", to = 2 }').text).toBe('Invited Cy to the group');
    const named = parseStoryLog(session('speakers = { { name = "A|cffff0000B" } }, messages = { { t = 1, e = "INVITE", k = "in", s = 1 } }'));
    expect(named.items[0]!.text).toBe('AB invited you to a group');
  });

  it('marks a line out of character', () => {
    expect(line('brb, doorbell')).toMatchObject({ ooc: true });
    expect(line('Ready when you are.')).not.toHaveProperty('ooc');
  });

  it('reads what a profile says, without its colour tags', () => {
    const borin = doc.speakers!.findLast((who) => who.name === 'Borin Fixture')!;
    expect(borin.details).toEqual({
      title: 'Captain of the Gate',
      pronouns: 'he/him',
      age: '45',
      eyes: 'Grey',
      currently: 'Escorting Élowyn to Stormwind',
      glance: 'Scar: Across the cheek',
    });
    const read = parseStoryLog(session('speakers = { { name = "Bo", look = "Broad, {col:ff0000}red{/col} beard {link*https://x*here}" } }'));
    expect(read.speakers![0]!.details).toEqual({ look: 'Broad, red beard here' });
    const headed = parseStoryLog(session('speakers = { { name = "Bo", look = "{h2}Eyes{/h2}Grey{p}Tall{/p}and thin" } }'));
    expect(headed.speakers![0]!.details).toEqual({ look: 'Eyes Grey Tall and thin' });
  });

  it('says "in a party" where the addon saw that the recorder was in one at login', () => {
    const group = (fields: string) =>
      parseStoryLog(session(`speakers = { { name = "Bo Test" } }, messages = { { t = 6, e = "SAY", m = "hi" }, { e = "GROUP", g = { 1 }, ${fields} } }`));
    expect(group('t = 12, start = true').items[1]!.text).toBe('In a party with Bo Test');
    expect(group('t = 12').items[1]!.text).toBe('Joined a party with Bo Test');
    // An older log has no such mark: then it is one that was saved within moments of the login.
    expect(group('t = 7').items[1]!.text).toBe('In a party with Bo Test');
  });

  it("knows the game world's time when each session began", () => {
    expect(doc.sessions!.at(-1)).toEqual({ started: 1898900000, clock: 390 });
    expect(doc.items.at(-1)!.session).toBe(3);
  });
});

describe('quests', () => {
  const accepted = line('from Gatekeeper Dummy');

  it('are lines of the recorder, linked like a quest in chat', () => {
    expect(accepted).toMatchObject({
      kind: 'message',
      type: 'QUEST_ACCEPTED',
      channels: ['quests'],
      quest: 90210,
      self: true,
      sender: 'Élowyn Testwood',
      target: 'Gatekeeper Dummy',
      text: '[A Test of Patience], from Gatekeeper Dummy',
    });
    expect(parseMarkup(accepted.raw)[0]).toEqual({ text: '[A Test of Patience]', color: '#ffd100', link: 'quest=90210' });
    expect(channelLabels(doc).get('quests')).toBe('Quests');
  });

  it('say whom they were handed in to, when that is known', () => {
    expect(doc.items.find((item) => item.type === 'QUEST_TURNED_IN')!.text).toBe('[A Test of Patience]');
    const read = parseStoryLog(
      session('speakers = { { name = "Marshal", npc = true } }, messages = { { t = 1, e = "QUEST_TURNED_IN", q = 7, m = "T", to = 1 } }'),
    );
    expect(read.items[0]!.text).toBe('[T], handed in to Marshal');
  });

  it.each([
    ['{ t = 1, e = "QUEST_ACCEPTED", q = 7 }', '[Quest 7]', 'quest=7'],
    ['{ t = 1, e = "QUEST_ACCEPTED", q = 7, m = "a|Hitem:1|h[b]|h" }', '[a[b]]', 'quest=7'],
    ['{ t = 1, e = "QUEST_ACCEPTED", m = "No number" }', 'No number', undefined],
    ['{ t = 1, e = "QUEST_ACCEPTED", q = -1, m = "Bad number" }', 'Bad number', undefined],
  ])('survive %s', (message, text, link) => {
    const [item] = parseStoryLog(session(`messages = { ${message} }`)).items;
    expect(item!.text).toBe(text);
    expect(parseMarkup(item!.raw).map((segment) => segment.link)).toEqual([link]);
  });

  it('keep the IDs of all other lines as they were', () => {
    // As the reader gave it before quests existed: saved edits are stored by these IDs.
    const before = parseStoryLog(session('messages = { { t = 5, e = "SAY", m = "hi" } }')).items[0]!.id;
    expect(before).toBe('oia7iitonp');
  });
});

describe('archive files', () => {
  const archive = STORYLOG.replace('StoryLogDB = {', 'StoryLogArchive2DB = {');

  it('read like the main log, with the same item IDs', () => {
    const read = parseLog(archive);
    expect(read.format).toBe('storylog');
    expect(read.items.map((item) => item.id)).toEqual(doc.items.map((item) => item.id));
  });

  it('keep their own name when they are exported', () => {
    const read = parseLog(archive);
    const { states } = computeSelection(read, { ...NO_FILTERS, channels: ['#4'] }, new Set());
    expect(exportLua(read, states)).toMatch(/^\s*StoryLogArchive2DB = \{/);
  });

  it.each(['StoryLogCharDB = { saved = true }', 'StoryLogArchiveDB = {}', 'StoryLogArchive1DBx = {}'])(
    'are not seen in %s',
    (source) => {
      expect(() => parseLog(source)).toThrow(NotLogFileError);
    },
  );

  it('ignore the bookkeeping of the split', () => {
    const read = parseLog(
      'StoryLogDB = { version = 1, archive = { volume = 2, held = { { sessions = 1 } }, pending = { volume = 2, ids = { x = 3 } } }, sessions = {} }',
    );
    expect(read.items).toEqual([]);
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
    expect(after).toHaveLength(26);
    expect(after).toEqual(ids.slice(-26));
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
      lines: 47,
      entries: 47,
      items: 47,
      typesInFile: 31,
      types: 31,
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

  it.each(['lead', 'from'])('notice a %s that points at nothing', (key) => {
    expect(audit(written(['["t"] = 5,', `["${key}"] = 1,`], lists))).toMatchObject(clean);
    expect(audit(written(['["t"] = 5,', `["${key}"] = 9,`], lists))).toMatchObject({ ...clean, dangling: 1 });
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
