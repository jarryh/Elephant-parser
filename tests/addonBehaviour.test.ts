/**
 * The StoryLog addon, run against a simulated game client (tests/addon/mock.lua).
 * It shows that the addon's own logic is right. It can't show that the game behaves as
 * simulated: for that the addon has to be tried in game.
 */
import { describe, expect, it } from 'vitest';
import { Client, ELOWYN, q } from './addon/client';
import { STORYLOG } from './helpers';

interface Message {
  t: number;
  e: string;
  m?: string;
  n?: number;
  p?: number;
  s?: number;
  sp?: number;
  to?: number;
}
interface Session {
  id: string;
  character: string;
  realm?: string;
  messages: Message[];
  speakers: { name: string; rp?: string; guid?: string }[];
  places: Record<string, unknown>[];
}

const session = (client: Client, index = 1) => client.get<Session>(`StoryLogDB.sessions[${index}]`);
const say = (sender: string, guid: string, text = 'hi') =>
  `chat("SAY", { text = ${q(text)}, sender = ${q(sender)}, guid = ${q(guid)}, lang = "Common" })`;
const ME = say('Élowyn Testwood', ELOWYN.guid);
const BORIN = say('Borin Fixture', 'Player-1-B');

describe('the test fixture', () => {
  const SETUP = String.raw`
    E, B, C = "Player-9999-0000000A", "Player-9999-0000000B", "Player-9999-0000000C"
    W.maps = { [1453] = "Stormwind City", [1429] = "Elwynn Forest" }
    W.infos[E] = { classFile = "PALADIN", race = "Human", sex = 3, first = "Élowyn", second = "Testwood" }
    W.infos[B] = { classFile = "WARRIOR", race = "Dwarf", sex = 2, first = "Borin", second = "Fixture" }
    W.infos[C] = { classFile = "MAGE", race = "Gnome", sex = 3, first = "Cedra", second = "Mock" }
    W.rp.player = "Élowyn Moonwhisper"
    W.rp["Borin Fixture"] = "Borin Ironvow"
  `;

  /** An evening in Stormwind with a party member, a stranger, NPCs, and a dungeon at the end. */
  const EVENING = String.raw`
    W.zone = "Stormwind City"; W.sub = "Cathedral Square"
    at("player", 1453, 0.52341, 0.67118, -8834.21, 640.14, 0)
    W.units.party1 = { guid = B, first = "Borin", second = "Fixture" }
    at("party1", 1453, 0.5262, 0.6730, -8836.6, 635.3, 0)
    fire("GROUP_ROSTER_UPDATE")
    W.units.target = W.units.party1
    W.now = 1898622200; chat("SAY", { text = 'Well met, "traveller".', sender = "Élowyn Testwood", guid = E, lang = "Common" })
    W.now = 1898622210; chat("EMOTE", { text = "bows \\ deeply.", sender = "Borin Fixture", guid = B })
    W.now = 1898622220; chat("TEXT_EMOTE", { text = "Borin Fixture waves at you.", sender = "Borin Fixture", guid = B })
    W.now = 1898622230; chat("TEXT_EMOTE", { text = "You wave back.", sender = "Élowyn Testwood", guid = E })
    W.now = 1898622240; chat("SAY", { text = "Kor ma dun.", sender = "Cedra Mock", guid = C, lang = "Gnomish" })
    W.now = 1898622250; slash("note The bargain")
    W.now = 1898622260; chat("SYSTEM", { text = "Borin Fixture rolls 57 (1-100)" })
    W.now = 1898622262; chat("SYSTEM", { text = "You are now rested." })
    W.now = 1898622270; chat("MONSTER_YELL", { text = "The test gates open!", sender = "Gatekeeper Dummy", guid = "Creature-0-4444-0-12-90001-0000000001" })
    W.now = 1898622280; chat("MONSTER_EMOTE", { text = "%s creaks ominously.", sender = "Straw Golem" })
    W.now = 1898622290; chat("WHISPER", { text = "a private secret", sender = "Cedra Mock", guid = C })
    W.now = 1898622300; chat("BN_WHISPER", { text = "a battle net note", sender = "|Kq1|k" })
    at("player", 1453, 0.5301, 0.6750, -8839.0, 628.4, 0)
    W.units.target = nil
    W.now = 1898622310; chat("SAY", { text = "Take |cnIQ2:|Hitem:12345::::::::70:::::|h[Fixture Cloak]|h|r, friend.", sender = "Élowyn Testwood", guid = E, lang = "Common" })
    slash("record channels on")
    W.now = 1898622320; chat("CHANNEL", { text = "Anyone seen the red door?", sender = "Cedra Mock", guid = C, flag = "NEWCOMER", base = "General - Stormwind City", zoneID = 1, lang = "Common" })
    slash("record channels off")
    W.now = 1898622325; chat("CHANNEL", { text = "not recorded", sender = "Cedra Mock", base = "Trade - City" })
    at("party1", 1429, 0.4170, 0.6550, -9464.8, 62.2, 0)
    W.now = 1898622330; chat("PARTY_LEADER", { text = "I'm waiting in Goldshire.", sender = "Borin Fixture", guid = B })
    W.now = 1898622340; chat("GUILD", { text = "evening all", sender = "Dorn Placeholder" })
    W.zone = "The Stockade"; W.sub = nil; W.inst = "The Stockade"; W.indoors = true
    at("player"); at("party1")
    W.now = 1898622600; chat("SAY", { text = "Dark in here.", sender = "Élowyn Testwood", guid = E, lang = "Common" })
    W.now = 1898622660
    for i = 1, 14 do chat("PARTY", { text = newSecret(), sender = newSecret(), guid = newSecret() }) end
    W.now = 1898622700; chat("PARTY", { text = "That was close.", sender = "Borin Fixture", guid = B })
    W.now = 1898622800
  `;

  const NEXT_EVENING = String.raw`
    W.zone = "Elwynn Forest"; W.sub = "Goldshire"; W.mini = "Lion's Pride Inn"; W.indoors = true
    at("player", 1429, 0.4398, 0.6585, -9462.7, 16.2, 0)
    W.now = 1898713800; chat("SAY", { text = "A new evening begins.", sender = "Élowyn Testwood", guid = E, lang = "Common" })
    W.now = 1898714000
  `;

  const OTHER_CHARACTER = String.raw`
    local D = "Player-9999-0000000D"
    W.zone = "Dun Morogh"
    W.now = 1898800010; chat("SAY", { text = "First", sender = "Dorn Placeholder", guid = D })
    W.now = 1898800020; chat("SAY", { text = "Again", sender = "Dorn Placeholder", guid = D })
    W.now = 1898800020; chat("SAY", { text = "Again", sender = "Dorn Placeholder", guid = D })
    W.now = 1898800030
  `;

  it('is exactly what the addon saves over three sessions', () => {
    let saved = new Client({ pre: 'TRP = true' }).run(SETUP).login().run(EVENING).logout();
    saved = new Client({ saved, pre: 'TRP = true' }).run(SETUP).run('W.now = 1898713700').login().run(NEXT_EVENING).logout();
    saved = new Client({ saved, me: { guid: 'Player-9999-0000000D', first: 'Dorn Placeholder' } })
      .run('W.now = 1898800000')
      .login()
      .run(OTHER_CHARACTER)
      .logout();
    // To update the fixture after changing the addon on purpose, write `saved` to it with LF line ends.
    expect(saved.replace(/\r\n/g, '\n')).toBe(STORYLOG);
  });
});

describe('hidden values', () => {
  it('never reach the saved file, and plain text beside them is kept', () => {
    const client = new Client({ pre: 'TRP = true; HOUSING = true' }).login();
    client.run(String.raw`
      W.allSecret = true; W.house = "House"; W.hood = "Hood"; W.inst = "Cave"; W.zone = "Z"
      W.units.party1 = { guid = "Player-1-B", first = "B", second = "C", map = 1, x = .5, y = .5, wx = 1, wy = 2, cont = 0 }
      W.units.target = W.units.party1
      fire("GROUP_ROSTER_UPDATE")
      chat("SAY", { text = "mine", sender = "Élowyn Testwood", guid = "Player-9999-0000000A" })
      chat("EMOTE", { text = "theirs", sender = newSecret(), guid = newSecret(), lang = "Common" })
      chat("MONSTER_SAY", { text = "npc", sender = "Guard", guid = newSecret() })
      chat("GUILD_DISCORD", { text = "discord", discord = newSecret() })
      chat("SAY", { text = newSecret(), sender = newSecret(), guid = newSecret(), discord = newSecret() })
      chat("PARTY", { text = newSecret() })
      chat("SYSTEM", { text = newSecret() })
      slash("")
    `);
    // The serializer throws on a secret, as the game drops them.
    const saved = client.logout();
    for (const text of ['"mine"', '"theirs"', '"npc"', '"discord"']) expect(saved).toContain(text);
    // Two hidden lines in a row are one entry. A hidden system line counts only with notices on.
    expect(saved).toContain('["n"] = 2');
    expect(client.get('NS.failures.count')).toBe(0);
  });

  it('are not needed: a client without them, or without the optional functions, still records', () => {
    const client = new Client();
    client.run('issecretvalue = nil; C_Map = nil; UnitPosition = nil; C_ChatInfo = nil; GetMinimapZoneText = nil; IsIndoors = nil');
    client.login().run(ME).run('slash("")');
    expect(session(client).messages).toHaveLength(1);
  });
});

describe('names', () => {
  it('are "Name-Realm" in retail, where housing has names too', () => {
    const client = new Client({ me: { guid: 'Player-1-A', first: 'Ann' }, regional: false, build: 120105, pre: 'HOUSING = true' });
    client.login().run(String.raw`
      W.house = "The Burrow"; W.hood = "Razorwind Shores"; W.zone = "Founder's Point"
      W.units.target = { guid = "Player-1-B", first = "Borin" }
      chat("SAY", { text = "a", sender = "Ann-Testrealm", guid = "Player-1-A" })
      chat("SAY", { text = "b", sender = "Borin-Testrealm", guid = "Player-1-B" })
      chat("SAY", { text = "c", sender = "Cedra-Otherrealm", guid = "Player-2-C" })
      chat("SAY", { text = "d", sender = "Dee" })
    `);
    const { speakers, messages, realm, places } = session(client);
    expect(speakers.map((who) => who.name)).toEqual(['Ann-Testrealm', 'Borin-Testrealm', 'Cedra-Otherrealm', 'Dee-Testrealm']);
    // The target has no realm in its name, and is still the same speaker.
    expect(messages[0]!.to).toBe(2);
    expect(realm).toBe('Testrealm');
    expect(places[0]).toMatchObject({ house: 'The Burrow', neighborhood: 'Razorwind Shores', room: 'Housing-Room-1' });
  });

  it.each([
    ['split in two', { first: 'Ann', second: 'Vale' }],
    ['joined', { first: 'Ann Vale' }],
    ['joined, with the surname again', { first: 'Ann Vale', second: 'Vale' }],
    ['with a realm', { first: 'Ann Vale-Testrealm' }],
  ])('are "First Surname" in WoW Forever, when the game gives them %s', (_name, name) => {
    const client = new Client({ me: { guid: 'Player-1-A', ...name } }).login();
    expect(session(client).character).toBe('Ann Vale');
  });

  it('keep a hyphen that is part of a surname', () => {
    const client = new Client().login().run(say('Mary Stone-Heart', 'Player-1-M'));
    expect(session(client).speakers[0]!.name).toBe('Mary Stone-Heart');
  });
});

describe('dice rolls', () => {
  it.each([
    ['%1$s würfelt. Ergebnis: %2$d (%3$d-%4$d)', 'Ann Vale würfelt. Ergebnis: 7 (1-20)', 'Ann Vale'],
    ['%s obtient un %d (%d-%d).', 'Ann Vale obtient un 7 (1-20).', 'Ann Vale'],
    ['%1$s掷出%2$d（%3$d-%4$d）', '安掷出7（1-20）', '安'],
    ['%s rolls %d (%d-%d)', 'Ann Vale rolls 100 (1-100)', 'Ann Vale'],
  ])("are told from other system lines by the client's own wording: %s", (format, line, who) => {
    const client = new Client({ pre: `ROLL_FORMAT = ${q(format)}` }).login();
    client.run(`chat("SYSTEM", { text = ${q(line)} }); chat("SYSTEM", { text = "Need Roll - 57 for [Cape] by Ann" })`);
    const { messages, speakers } = session(client);
    expect(messages).toMatchObject([{ e: 'ROLL', s: 1 }]);
    expect(speakers[0]!.name).toBe(who);
  });

  it('follow their own setting', () => {
    const client = new Client().login();
    client.run('slash("record rolls off"); chat("SYSTEM", { text = "Ann rolls 5 (1-6)" })');
    expect(session(client).messages).toEqual([]);
    client.run('slash("record notices on"); chat("SYSTEM", { text = "Ann rolls 5 (1-6)" })');
    expect(session(client).messages).toMatchObject([{ e: 'SYSTEM' }]);
  });
});

describe('roleplay names', () => {
  it('fill in when a profile arrives late, and a change keeps the earlier lines as they were', () => {
    const client = new Client({ pre: 'TRP = true' }).login();
    client.run(BORIN);
    client.run('W.rp["Borin Fixture"] = "Borin Ironvow"').run(BORIN);
    client.run('W.rp["Borin Fixture"] = "A Hooded Stranger"').run(BORIN);
    const { messages, speakers } = session(client);
    expect(messages.map((message) => message.s)).toEqual([1, 1, 2]);
    expect(speakers.map((who) => who.rp)).toEqual(['Borin Ironvow', 'A Hooded Stranger']);
  });

  it("are left out when the profile only repeats the character's name", () => {
    const client = new Client({ pre: 'TRP = true' }).login();
    client.run('W.rp["Same Name"] = "Same Name"').run(say('Same Name', 'Player-1-S'));
    expect(session(client).speakers[0]!.rp).toBeUndefined();
  });
});

describe('positions', () => {
  it('are saved for raid members, and not from a roster slot that changed hands', () => {
    const client = new Client().login();
    client.run(String.raw`
      W.raid = true; W.members = 3
      W.units.raid1 = W.units.player
      W.units.raid2 = { guid = "Player-1-B", map = 1, x = .1, y = .2, wx = 5, wy = 6, cont = 0 }
      W.units.raid3 = { guid = "Player-1-C" }
      fire("GROUP_ROSTER_UPDATE")
      chat("RAID", { text = "x", sender = "B B", guid = "Player-1-B" })
      chat("RAID", { text = "y", sender = "C C", guid = "Player-1-C" })
      W.units.raid2.guid = "Player-1-Z"
      chat("RAID", { text = "z", sender = "B B", guid = "Player-1-B" })
    `);
    const [withPosition, withoutPosition, stale] = session(client).messages;
    expect(withPosition!.sp).toBeDefined();
    expect(withoutPosition!.sp).toBeUndefined();
    expect(stale!.sp).toBeUndefined();
  });

  it('reuse a place until you have moved a few yards', () => {
    const client = new Client().login().run('W.zone = "Z"');
    for (const yards of [100, 101, 102.5, 104, 104.5]) {
      client.run(`at("player", nil, nil, nil, ${yards}, 50, 0)`).run(BORIN);
    }
    expect(session(client).messages.map((message) => message.p)).toEqual([1, 1, 1, 2, 2]);
  });
});

describe('sessions and settings', () => {
  it('record nothing while recording is off, not even a note', () => {
    const client = new Client().login();
    client.run('slash("off")').run(BORIN).run('slash("note lost")');
    expect(session(client).messages).toEqual([]);
    expect(client.printed()).toContain('was not saved');
  });

  it('cope with chat events that this client does not have', () => {
    const client = new Client({ pre: 'NO_EVENT = { CHAT_MSG_GUILD_DISCORD = true, CHAT_MSG_MONSTER_PARTY = true }' });
    client.login().run(BORIN);
    expect(session(client).messages).toHaveLength(1);
  });

  it('do not save a session in which nothing was said', () => {
    expect(new Client().login().logout()).not.toContain('["messages"]');
  });

  it('leave a file from a newer StoryLog alone', () => {
    const client = new Client({ saved: 'StoryLogDB = { version = 2, sessions = {}, future = true }' }).login();
    client.run(BORIN).run('slash("")');
    const saved = client.logout();
    expect(saved).toContain('["version"] = 2');
    expect(saved).not.toMatch(/settings|messages/);
    expect(client.printed()).toContain('newer StoryLog');
  });

  it('keep saved settings and give new ones their defaults', () => {
    const client = new Client({ saved: 'StoryLogDB = { version = 1, sessions = {}, settings = { speech = false } }' }).login();
    expect(client.get('StoryLogDB.settings')).toMatchObject({ speech: false, rolls: true, recording: true });
  });

  it('suggest pruning once the file slows down login', () => {
    const saved = `StoryLogDB = { version = 1, sessions = { { id = "big", started = 1898600000, messages = {} } } }
      for i = 1, 50000 do StoryLogDB.sessions[1].messages[i] = { t = 1898600000 + i, e = "SAY", m = "x" } end`;
    expect(new Client({ saved }).login().printed()).toContain('prune 90');
    expect(new Client().login().printed()).not.toContain('prune');
  });

  it('add no globals but the slash command and the saved variable', () => {
    expect(new Client().login().get('addedGlobals()')).toEqual(['SLASH_STORYLOG1', 'StoryLogDB']);
  });
});

describe('/storylog prune', () => {
  const OLD = `StoryLogDB = { version = 1, sessions = {
    { id = "old", started = 1000, messages = { { t = 1000, e = "SAY", m = "old" } } },
    { id = "new", started = 1898621000, messages = { { t = 1898621000, e = "SAY", m = "new" } } },
  } }`;
  const ids = (client: Client) => client.get<Session[]>('StoryLogDB.sessions').map((entry) => entry.id);

  it('only says what it would delete, until it is confirmed', () => {
    const client = new Client({ saved: OLD }).login().run('slash("prune 30")');
    expect(ids(client)).toHaveLength(3);
    expect(client.printed()).toContain('prune 30 confirm');
  });

  it.each(['prune', 'prune 0', 'prune -5', 'prune x confirm', 'prune 1.5 confirm'])('refuses %j', (command) => {
    const client = new Client({ saved: OLD }).login().run(`slash(${q(command)})`);
    expect(ids(client)).toHaveLength(3);
  });

  it('deletes the old sessions and never the current one', () => {
    const client = new Client({ saved: OLD }).login().run('slash("prune 30 confirm")');
    expect(ids(client)).toEqual(['new', expect.stringContaining(ELOWYN.guid)]);
  });
});

describe('when something goes wrong', () => {
  it('keeps the text of a line that it could not describe, and says so', () => {
    const client = new Client().login();
    client.run('NS.playerPlace = function() error("no place today") end').run(ME).run(BORIN).run('slash("")');
    expect(session(client).messages).toEqual([
      { t: 1898622000, e: 'SAY', m: 'hi' },
      { t: 1898622000, e: 'SAY', m: 'hi' },
    ]);
    expect(client.get('NS.failures.count')).toBe(2);
    const printed = client.printed();
    // Once, not for every line.
    expect(printed.match(/could not be recorded in full/g)).toHaveLength(1);
    expect(printed).toMatch(/2 lines were not recorded in full.*no place today/);
  });

  it('lets no error through to the game, which would hide it', () => {
    const client = new Client().login();
    // `run` would throw if the error left the addon.
    client.run('NS.db.settings = nil').run(BORIN);
    expect(client.get('NS.failures.count')).toBe(1);
    expect(client.get<string>('NS.failures.first')).toContain('settings');
  });

  it('takes a roll wording that Lua cannot match as no roll, not as an error', () => {
    const client = new Client().login();
    // What a broken pattern would do inside the addon, for this line only.
    client.run(String.raw`
      local match = string.match
      string.match = function(text, ...)
        if text:find("rolls", 1, true) then error("malformed pattern") end
        return match(text, ...)
      end
    `);
    client.run('slash("record notices on"); chat("SYSTEM", { text = "Ann rolls 5 (1-6)" })');
    expect(session(client).messages).toMatchObject([{ e: 'SYSTEM' }]);
    expect(client.get('NS.failures.count')).toBe(0);
  });
});
