/**
 * The StoryLog addon, run against a simulated game client (tests/addon/mock.lua).
 * It shows that the addon's own logic is right. It can't show that the game behaves as
 * simulated: for that the addon has to be tried in game.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Client, ELOWYN, q, type Files } from './addon/client';
import { STORYLOG } from './helpers';

interface Message {
  t: number;
  e: string;
  m?: string;
  n?: number;
  q?: number;
  g?: number[];
  raid?: boolean;
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
    W.quests[90210] = { title = "A Test of Patience" }
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
    W.units.npc = { guid = "Creature-0-4444-0-12-90001-0000000001", first = "Gatekeeper Dummy" }
    W.now = 1898622255; W.quests[90210].inLog = true; fire("QUEST_ACCEPTED", 90210)
    W.units.npc = nil
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
    W.now = 1898622690; fire("QUEST_TURNED_IN", 90210, 500, 120)
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

  /** A morning on the road with Borin: what happens besides talking. */
  const ROAD = String.raw`
    W.maps[1436] = "Westfall"
    local LINEN, RAG, RING ="|cffffffff|Hitem:2589::::::::70:::::|h[Linen Cloth]|h|r", "|cff9d9d9d|Hitem:4|h[Torn Rag]|h|r", "|cff1eff00|Hitem:9999::::::::70:::::|h[Silver Ring]|h|r"
    W.profiles["Borin Fixture"] = {
      characteristics = { FT = "Captain of the Gate", AG = "45", EC = "Grey" },
      character = { CU = "Escorting Élowyn to Stormwind" },
      misc = { PE = { ["1"] = { AC = true, TI = "Scar", TX = "Across the cheek" } } },
      pronouns = "he/him",
    }
    W.now = 1898900060; chat("SYSTEM", { text = "You have invited Borin Fixture to join your group." })
    W.units.party1 = { guid = B, first = "Borin", second = "Fixture" }
    at("party1", 1429, 0.4180, 0.6560, -9466.0, 61.0, 0)
    W.leader = "player"; W.now = 1898900070; fire("GROUP_ROSTER_UPDATE")
    W.now = 1898900080; chat("SAY", { text = "Ready when you are.", sender = "Borin Fixture", guid = B, lang = "Common" })
    W.status["Borin Fixture"] = 2
    W.now = 1898900090; chat("PARTY", { text = "brb, doorbell", sender = "Borin Fixture", guid = B })
    W.status["Borin Fixture"] = 1
    W.units.npc = W.units.party1; W.now = 1898900100; fire("TRADE_SHOW")
    W.trade = { theirs = { { link = LINEN, count = 5 } }, myMoney = 1500 }
    fire("TRADE_TARGET_ITEM_CHANGED", 1); fire("TRADE_MONEY_CHANGED"); fire("TRADE_ACCEPT_UPDATE", 1, 1)
    W.trade = nil; fire("TRADE_CLOSED"); fire("UI_INFO_MESSAGE", 1, "Trade complete.")
    W.units.npc = { guid = "Creature-0-4444-0-12-295-0000000002", first = "Innkeeper Farley" }
    W.gossip = { text = "Welcome to the Lion's Pride Inn, $N!$BCome in.", options = { "Make this inn your home.", "Goodbye." } }
    W.now = 1898900110; fire("GOSSIP_SHOW"); C_GossipInfo.SelectOption(101)
    W.quests[60] = { title = "Lost Necklace", inLog = true }
    W.window = { id = 60, text = "I lost my necklace by the river.", goal = "Find the necklace." }
    W.now = 1898900120; fire("QUEST_DETAIL"); fire("QUEST_ACCEPTED", 60)
    W.units.npc = nil
    W.book = { title = "A Weathered Plaque", pages = { "<HTML><BODY><P>Here stood the old mill.</P></BODY></HTML>" } }
    W.now = 1898900130; fire("ITEM_TEXT_READY")
    W.units.target = { guid = "Creature-0-4444-0-12-116-0000000003", first = "Defias Thug", hostile = true }
    W.now = 1898900200; fire("PLAYER_REGEN_DISABLED"); W.now = 1898900225; fire("PLAYER_REGEN_ENABLED")
    W.now = 1898900226; chat("LOOT", { text = "You receive loot: " .. RAG .. "x2." })
    W.now = 1898900227; chat("LOOT", { text = "You receive loot: " .. RING .. "." })
    W.units.target = W.units.party1; W.spells[19750] = "Flash of Light"
    W.now = 1898900240; fire("UNIT_SPELLCAST_SENT", "player", "Borin", "Cast-1", 19750); fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-1", 19750)
    W.now = 1898900250; fire("DUEL_REQUESTED", "Borin Fixture")
    W.now = 1898900280; chat("SYSTEM", { text = "Borin Fixture has defeated Élowyn Testwood in a duel" })
    W.now = 1898900290; slash("note Into Westfall")
    W.worn[1] = "|cff1eff00|Hitem:7720::::::::70:::::|h[Feathered Hat]|h|r"; W.now = 1898900300; fire("PLAYER_EQUIPMENT_CHANGED", 1); runTimers()
    W.zone = "Westfall"; W.sub = "Sentinel Hill"
    at("player", 1436, 0.5600, 0.4900, -10628.0, 1036.0, 0); at("party1", 1436, 0.5610, 0.4910, -10629.0, 1035.0, 0)
    W.now = 1898900400; fire("ZONE_CHANGED_NEW_AREA"); runTimers()
    W.now = 1898900500; fire("PLAYER_CONTROL_LOST"); W.taxi = true; runTimers()
    W.zone = "Stormwind City"; W.sub = "Trade District"; at("player", 1453, 0.6200, 0.7100, -8830.0, 620.0, 0)
    W.now = 1898900680; W.taxi = false; fire("PLAYER_CONTROL_GAINED")
    W.now = 1898900700; chat("PARTY", { text = "Took the road. See you at the gate.", sender = "Borin Fixture", guid = B })
    W.outgoing = { items = { { link = LINEN, count = 5 } } }
    W.now = 1898900710; SendMail("Borin Fixture", "Your cloth", "Thank you for the escort,\nand for the cloth back."); fire("MAIL_SEND_SUCCESS")
    W.now = 1898900720; fire("PLAYER_LEVEL_UP", 12)
    W.now = 1898900800
  `;

  it('is exactly what the addon saves over four sessions', () => {
    let saved = new Client({ pre: 'TRP = true' }).run(SETUP).login().run(EVENING).logout();
    saved = new Client({ saved, pre: 'TRP = true' }).run(SETUP).run('W.now = 1898713700').login().run(NEXT_EVENING).logout();
    saved = new Client({ saved, me: { guid: 'Player-9999-0000000D', first: 'Dorn Placeholder' } })
      .run('W.now = 1898800000')
      .login()
      .run(OTHER_CHARACTER)
      .logout();
    saved = new Client({ saved, pre: 'TRP = true' })
      .run(SETUP)
      .run('W.now = 1898900000; W.gameTime = { 6, 30 }; W.zone = "Elwynn Forest"; W.sub = "Goldshire"; W.worn[5] = "|cffffffff|Hitem:6096|h[Apprentice\'s Shirt]|h|r"')
      .run('at("player", 1429, 0.4170, 0.6550, -9464.8, 62.2, 0)')
      .login()
      .run(ROAD)
      .logout();
    // After changing the addon on purpose, run the tests once with UPDATE_FIXTURE=1.
    if (process.env.UPDATE_FIXTURE) {
      writeFileSync(new URL('./fixtures/storylog.lua', import.meta.url), saved.replace(/\r\n/g, '\n'));
    }
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
      slash("status")
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
    client.login().run(ME).run('slash("status")');
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

  it('give the limit its default, and keep one that was set', () => {
    expect(new Client().login().get('StoryLogDB.settings.limit')).toBe(3);
    const saved = 'StoryLogDB = { version = 1, sessions = {}, settings = { limit = 7 } }';
    expect(new Client({ saved }).login().get('StoryLogDB.settings.limit')).toBe(7);
    const broken = 'StoryLogDB = { version = 1, sessions = {}, settings = { limit = "lots" } }';
    expect(new Client({ saved: broken }).login().get('StoryLogDB.settings.limit')).toBe(3);
  });

  it('add no globals but the slash command and the saved variables', () => {
    const client = new Client().login();
    expect(client.get('addedGlobals()')).toEqual(['SLASH_STORYLOG1', 'StoryLogDB']);
    client.logout();
    expect(client.get('addedGlobals()')).toEqual(['SLASH_STORYLOG1', 'StoryLogCharDB', 'StoryLogDB']);
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
    client.run('NS.playerPlace = function() error("no place today") end').run(ME).run(BORIN);
    // Said a moment later: printing inside one of the game's own functions would taint the chat.
    expect(client.printed()).toBe('');
    client.run('runTimers(); slash("status")');
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

describe('the group', () => {
  const B = 'W.units.party1 = { guid = "Player-1-B", first = "Borin", second = "Fixture" }';
  const C = 'W.units.party2 = { guid = "Player-1-C", first = "Cedra", second = "Mock" }';
  const ROSTER = 'fire("GROUP_ROSTER_UPDATE")';
  const groups = (client: Client) => session(client).messages.filter((message) => message.e === 'GROUP');
  const names = (client: Client, message: Message) => message.g!.map((index) => session(client).speakers[index - 1]!.name);

  it('is saved when you join, with what is known of each member', () => {
    const client = new Client({ pre: 'TRP = true' }).login();
    client.run('W.infos["Player-1-B"] = { classFile = "WARRIOR", race = "Dwarf", sex = 2 }; W.rp["Borin Fixture"] = "Borin Ironvow"');
    client.run('W.now = W.now + 60').run(B).run(ROSTER);
    expect(groups(client)).toEqual([{ t: 1898622060, e: 'GROUP', g: [1], p: 1 }]);
    expect(session(client).speakers[0]).toMatchObject({ name: 'Borin Fixture', class: 'WARRIOR', race: 'Dwarf', rp: 'Borin Ironvow' });
  });

  it('is saved at login when you are already in one, and not when you are in none', () => {
    const client = new Client().run(B).login();
    expect(groups(client)).toEqual([{ t: 1898622000, e: 'GROUP', g: [1], p: 1, start: true }]);
    expect(groups(new Client().login().run(ROSTER))).toEqual([]);
  });

  it('is one that you were in already when the game only knows it a few seconds after login', () => {
    // Something is said first, and the roster comes late.
    const late = new Client().login().run(ROSTER).run(ME).run('W.now = W.now + 5').run(B).run(ROSTER);
    expect(groups(late)).toMatchObject([{ start: true }]);
    // Minutes later it is a group that you joined.
    const joined = new Client().login().run(ROSTER).run('W.now = W.now + 300').run(B).run(ROSTER);
    expect(groups(joined)).toHaveLength(1);
    expect(groups(joined)[0]).not.toHaveProperty('start');
  });

  it('is one line while it changes within seconds, and a new line after that', () => {
    const client = new Client().login().run(B).run(ROSTER);
    client.run('W.now = W.now + 5').run(C).run(ROSTER);
    expect(groups(client)).toHaveLength(1);
    expect(names(client, groups(client)[0]!)).toEqual(['Borin Fixture', 'Cedra Mock']);

    client.run('W.now = W.now + 60; W.units.party1 = nil').run(ROSTER);
    expect(groups(client).map((message) => names(client, message))).toEqual([['Borin Fixture', 'Cedra Mock'], ['Cedra Mock']]);
  });

  it('is a new line when something was said in between', () => {
    const client = new Client().login().run(B).run(ROSTER).run(ME).run(C).run(ROSTER);
    expect(session(client).messages.map((message) => message.e)).toEqual(['GROUP', 'SAY', 'GROUP']);
  });

  it('is saved once, however often the game reports it', () => {
    const client = new Client().login().run(B);
    client.run(ROSTER).run('W.now = W.now + 60').run(ROSTER).run('fire("PLAYER_ENTERING_WORLD", false, true)');
    expect(groups(client)).toHaveLength(1);
  });

  it('says when you leave, and whether it is a raid', () => {
    const client = new Client().login().run(B).run(ROSTER);
    client.run('W.now = W.now + 60; W.units.party1 = nil').run(ROSTER);
    client.run('W.now = W.now + 60; W.raid = true; W.units.raid1 = W.units.player; W.units.raid2 = { guid = "Player-1-C", first = "Cedra", second = "Mock" }');
    client.run(ROSTER);
    expect(groups(client).map(({ g, raid }) => [g!.length, raid])).toEqual([[1, undefined], [0, undefined], [1, true]]);
  });

  it('is not touched while the game hides who is in it', () => {
    const client = new Client().login().run(B).run(ROSTER);
    client.run('W.now = W.now + 60; W.allSecret = true').run(ROSTER);
    client.run('W.allSecret = false').run(ROSTER);
    expect(groups(client)).toHaveLength(1);
    // Nor when a member has no name yet.
    client.run('W.now = W.now + 60; W.units.party2 = { guid = "Player-1-C" }').run(ROSTER);
    expect(groups(client)).toHaveLength(1);
  });

  it('follows its own setting, and is no session by itself', () => {
    const off = new Client().login().run('slash("record group off")').run(B).run(ROSTER);
    expect(groups(off)).toEqual([]);
    expect(new Client().login().run(B).run(ROSTER).logout()).not.toContain('["messages"]');
  });
});

describe('quests', () => {
  const GIVER = 'W.units.npc = { guid = "Creature-0-1-0-1-777-0000000001", first = "Quest Giver" }';
  const quests = (client: Client) => session(client).messages;

  it('are saved when accepted and when handed in, with the NPC and the place', () => {
    const client = new Client().login();
    client.run('W.quests[7] = { title = "A Test of Patience", inLog = true }').run(GIVER);
    client.run('fire("QUEST_ACCEPTED", 7); W.units.npc = nil; W.now = W.now + 60; fire("QUEST_TURNED_IN", 7, 500, 120)');
    expect(quests(client)).toEqual([
      { t: 1898622000, e: 'QUEST_ACCEPTED', q: 7, m: 'A Test of Patience', p: 1, s: 1, to: 2 },
      { t: 1898622060, e: 'QUEST_TURNED_IN', q: 7, m: 'A Test of Patience', p: 1, s: 1 },
    ]);
    expect(session(client).speakers).toMatchObject([{ name: 'Élowyn Testwood' }, { name: 'Quest Giver', npc: true, id: 777 }]);
  });

  it('are found on a client that puts the quest log index first', () => {
    const client = new Client().login().run('W.quests[7] = { title = "T", inLog = true }; fire("QUEST_ACCEPTED", 3, 7)');
    expect(quests(client)).toMatchObject([{ q: 7, m: 'T' }]);
  });

  it('that were in the quest log at login are known when they are handed in', () => {
    const client = new Client().run('W.quests[5] = { title = "Old", inLog = true }').login();
    client.run('fire("QUEST_TURNED_IN", 5, 0, 0); fire("QUEST_TURNED_IN", 5, 0, 0)');
    expect(quests(client)).toMatchObject([{ e: 'QUEST_TURNED_IN', q: 5, m: 'Old' }]);
  });

  it('that the game keeps hidden are left out', () => {
    const client = new Client().login();
    client.run('W.quests[8] = { title = "Tracker", inLog = true, hidden = true }; W.quests[9] = { title = "Area", inLog = true, task = true }');
    client.run('fire("QUEST_ACCEPTED", 8); fire("QUEST_ACCEPTED", 9); fire("QUEST_TURNED_IN", 8, 0, 0); fire("QUEST_TURNED_IN", 4242, 0, 0)');
    expect(quests(client)).toEqual([]);
  });

  it('get a title that arrives late', () => {
    const client = new Client().login().run('W.quests[7] = { inLog = true }; fire("QUEST_ACCEPTED", 7)');
    expect(quests(client)[0]!.m).toBeUndefined();
    client.run('W.quests[7].title = "Late"; runTimers()');
    expect(quests(client)).toMatchObject([{ q: 7, m: 'Late' }]);
  });

  it('are all saved, by number, on a client that cannot tell which are hidden', () => {
    const client = new Client({ pre: 'NO_QUESTLOG = true' }).login();
    client.run('fire("QUEST_ACCEPTED", 7); fire("QUEST_TURNED_IN", 8, 0, 0)');
    expect(quests(client)).toMatchObject([{ e: 'QUEST_ACCEPTED', q: 7 }, { e: 'QUEST_TURNED_IN', q: 8 }]);
    expect(quests(client)[0]!.m).toBeUndefined();
  });

  it('follow their own setting, and are still known afterwards', () => {
    const client = new Client().login().run('W.quests[7] = { title = "T", inLog = true }');
    client.run('slash("record quests off"); fire("QUEST_ACCEPTED", 7)');
    expect(quests(client)).toEqual([]);
    client.run('slash("record quests on"); fire("QUEST_TURNED_IN", 7, 0, 0)');
    expect(quests(client)).toMatchObject([{ e: 'QUEST_TURNED_IN', q: 7 }]);
  });

  it('keep their number when the rest fails, or is hidden', () => {
    const client = new Client().login().run('W.quests[7] = { title = "T", inLog = true }');
    client.run('local place = NS.playerPlace; NS.playerPlace = function() error("no place today") end; fire("QUEST_ACCEPTED", 7); NS.playerPlace = place');
    expect(quests(client)).toEqual([{ t: 1898622000, e: 'QUEST_ACCEPTED', q: 7 }]);
    expect(client.get('NS.failures.count')).toBe(1);

    client.run('W.allSecret = true').run(GIVER).run('fire("QUEST_TURNED_IN", 7, 0, 0)');
    expect(quests(client)[1]).toEqual({ t: 1898622000, e: 'QUEST_TURNED_IN', q: 7, p: 1, s: 1 });
    // The serializer throws on a hidden value.
    expect(client.logout()).toContain('QUEST_TURNED_IN');
  });
});

describe('archive files', () => {
  /** A main log of two finished sessions, about 10 KB each, that is split at 5 KB. */
  const MAIN = String.raw`
    local function lines(from)
      local list = {}
      for i = 1, 100 do list[i] = { t = from + i, e = "SAY", m = ("x"):rep(20) } end
      return list
    end
    StoryLogDB = { version = 1, settings = { limit = 0.005 }, sessions = {
      { id = "one", character = "Ann Test", started = 1000, messages = lines(1000) },
      { id = "two", character = "Bo Test", started = 2000, messages = lines(2000) },
    } }
  `;
  const A1 = 'StoryLog_Archive1';
  const sessionsIn = (text = '') => [...text.matchAll(/^\["id"\] = "([^"]+)",/gm)].map((found) => found[1]!);
  const everywhere = (files: Files) =>
    Object.entries(files)
      .filter(([name]) => name.startsWith('StoryLog'))
      .flatMap(([, text]) => sessionsIn(text));
  /** Logs in with these files, says one line, and logs out. */
  const play = (files: Files, before = '') => {
    const client = new Client({ files }).run(before).login().run(ME);
    return { client, printed: client.printed(), files: client.logoutAll() };
  };

  it('are not loaded while the log is small', () => {
    const client = new Client({ saved: MAIN.replace('0.005', '3') }).login();
    expect(client.get(`C_AddOns.IsAddOnLoaded(${q(A1)})`)).toBe(false);
    expect(client.printed()).toBe('');
    expect(sessionsIn(client.logout())).toEqual(['one', 'two']);
  });

  it('take the finished sessions, which leave the main log one login later', () => {
    const first = play({ StoryLog: MAIN });
    expect(first.printed).toContain('2 sessions were copied to StoryLog_Archive1.lua');
    expect(sessionsIn(first.files[A1])).toEqual(['one', 'two']);
    // Still in the main log, with the session that was just played.
    expect(sessionsIn(first.files.StoryLog)).toHaveLength(3);

    const second = play(first.files);
    expect(second.printed).toContain('2 older sessions are now in StoryLog_Archive1.lua');
    expect(sessionsIn(second.files[A1])).toEqual(['one', 'two']);
    const left = sessionsIn(second.files.StoryLog);
    expect(left).toHaveLength(2);
    expect(left).not.toContain('one');

    // The two short sessions that are left are under the limit.
    const third = play(second.files);
    expect(third.printed).toBe('');
    expect(third.client.get(`C_AddOns.IsAddOnLoaded(${q(A1)})`)).toBe(false);
    expect(third.files[A1]).toBe(second.files[A1]);
    for (const { files } of [first, second, third]) expect(everywhere(files)).toEqual(expect.arrayContaining(['one', 'two']));
  });

  it('hold every line of what they took', () => {
    const { files } = play(play({ StoryLog: MAIN }).files);
    expect(files[A1]!.match(/\["m"\] = /g)).toHaveLength(200);
    expect(files[A1]).toContain('StoryLogArchive1DB = {');
  });

  it('do not get a session twice when the game never saved the first copy', () => {
    play({ StoryLog: MAIN });
    const again = play({ StoryLog: MAIN });
    expect(sessionsIn(again.files[A1])).toEqual(['one', 'two']);

    const twice = play({ ...again.files, StoryLog: MAIN.replace('0.005', '0.005, group = true') });
    expect(sessionsIn(twice.files[A1])).toEqual(['one', 'two']);
  });

  it.each([
    ['its file was not written', (files: Files) => ({ StoryLog: files.StoryLog! }), ''],
    ['the game loads it without its file', (files: Files) => files, `W.addons.${A1}.forgets = true`],
  ])('delete nothing from the main log when %s', (_name, change, before) => {
    const copied = play({ StoryLog: MAIN }).files;
    const lost = play(change(copied), before);
    expect(lost.printed).toContain('StoryLog_Archive1.lua came back with 0 sessions where 2 were saved');
    expect(lost.printed).toContain('Nothing was deleted');
    expect(sessionsIn(lost.files.StoryLog)).toEqual(expect.arrayContaining(['one', 'two']));
    // They were copied again, and leave once that copy is seen.
    expect(sessionsIn(lost.files[A1])).toEqual(['one', 'two']);
    const after = play(lost.files);
    expect(after.printed).toContain('2 older sessions are now in');
    expect(sessionsIn(after.files.StoryLog)).not.toContain('one');
  });

  it('keep a session in the main log when the copy has fewer lines', () => {
    const copied = play({ StoryLog: MAIN }).files;
    const cut = copied[A1]!.replace(/\{\r\n\["t"\] = 1001,[^}]*\},\r\n/, '');
    expect(cut).not.toBe(copied[A1]);
    const after = play({ ...copied, [A1]: cut });
    expect(sessionsIn(after.files.StoryLog)).toContain('one');
    expect(sessionsIn(after.files.StoryLog)).not.toContain('two');
  });

  it.each([
    ['missing', `W.addons.${A1} = nil`, 'MISSING'],
    ['disabled', `W.addons.${A1}.disabled = true`, 'DISABLED'],
  ])('leave everything as it is when the add-on is %s', (_name, before, reason) => {
    const { printed, files } = play({ StoryLog: MAIN }, before);
    expect(printed).toContain(`StoryLog_Archive1 can't be used (${reason})`);
    expect(sessionsIn(files.StoryLog)).toHaveLength(3);
    expect(files.StoryLog).not.toContain('["pending"]');
    expect(files[A1]).toBeUndefined();
  });

  it('are left alone when a newer StoryLog wrote them', () => {
    const { printed, files } = play({ StoryLog: MAIN, [A1]: 'StoryLogArchive1DB = { version = 2, future = true }' });
    expect(printed).toContain("can't be used (a newer StoryLog wrote it)");
    expect(files[A1]).toContain('["version"] = 2');
    expect(files[A1]).not.toContain('sessions');
    expect(sessionsIn(files.StoryLog)).toHaveLength(3);
  });

  /** Two more sessions come back from an older copy of the log, after the first file took one and two. */
  const twoMore = () => {
    const filled = play(play({ StoryLog: MAIN }).files).files;
    const more = MAIN.replace('"one"', '"three"').replace('"two"', '"four"');
    const archive = /\["archive"\] = \{[\s\S]*?\r\n\},\r\n(?=\["sessions"\])/.exec(filled.StoryLog!)![0];
    const main = `${more}\nStoryLogDB.archive = (function() local ${archive.replace('["archive"]', 'archive').replace(/,\r\n$/, '')} return archive end)()`;
    return { ...filled, StoryLog: main };
  };

  it.each([
    ['in bytes', 'NS.VOLUME_BYTES = 25000'],
    ['in different strings and numbers', 'NS.VOLUME_CONSTANTS = 300'],
  ])('give way to the next file when one is full %s', (_name, before) => {
    const next = play(twoMore(), before);
    expect(next.printed).toContain('copied to StoryLog_Archive2.lua');
    expect(next.printed).not.toContain('emptied');
    expect(sessionsIn(next.files.StoryLog_Archive2)).toEqual(['three', 'four']);
    expect(sessionsIn(next.files[A1])).toEqual(['one', 'two']);
    expect(next.client.get('StoryLogDB.archive.volume')).toBe(2);
  });

  it('measure each session once in a login', () => {
    const before = `
      local measure = NS.sessionSize
      MEASURED = {}
      NS.sessionSize = function(session)
        MEASURED[session.id] = (MEASURED[session.id] or 0) + 1
        return measure(session)
      end
      NS.VOLUME_BYTES = 25000`;
    const { client } = play(twoMore(), before);
    expect(client.get('MEASURED')).toEqual({ one: 1, two: 1, three: 1, four: 1 });
  });

  describe('when all are full', () => {
    const SESSION = (id: string, started: number) => `{ id = "${id}", started = ${started}, messages = { { t = ${started}, e = "SAY", m = "old" } } }`;
    /** Each file holds a session of its own, and the fifth holds the oldest, three of them. */
    const full = (): Files => {
      const files: Files = { StoryLog: MAIN };
      for (let volume = 1; volume <= 12; volume++) {
        const sessions =
          volume === 5
            ? [SESSION('old5a', 100), SESSION('old5b', 200), SESSION('old5c', 300)]
            : [SESSION(`old${volume}`, 400 + volume)];
        files[`StoryLog_Archive${volume}`] = `StoryLogArchive${volume}DB = { version = 1, sessions = { ${sessions.join(', ')} } }`;
      }
      return files;
    };
    const A5 = 'StoryLog_Archive5';
    const untouched = (files: Files) => {
      for (let volume = 1; volume <= 12; volume++) {
        if (volume !== 5) expect(sessionsIn(files[`StoryLog_Archive${volume}`])).toEqual([`old${volume}`]);
      }
    };

    it('empty the one whose sessions are oldest, and say so', () => {
      const emptied = play(full(), 'NS.VOLUME_BYTES = 1');
      expect(emptied.printed).toContain('every archive file is full, so StoryLog_Archive5.lua was emptied');
      expect(emptied.printed).toContain('It held 3 sessions');
      expect(emptied.printed).toContain('copied to StoryLog_Archive5.lua');
      expect(sessionsIn(emptied.files[A5])).toEqual(['one', 'two']);
      untouched(emptied.files);
      expect(emptied.client.get('StoryLogDB.archive.pending.volume')).toBe(5);
      // Still in the main log, until the file is seen to hold them.
      expect(sessionsIn(emptied.files.StoryLog)).toEqual(expect.arrayContaining(['one', 'two']));

      const after = play(emptied.files);
      expect(after.printed).toContain('2 older sessions are now in StoryLog_Archive5.lua');
      expect(sessionsIn(after.files.StoryLog)).not.toContain('one');
      untouched(after.files);
    });

    it('warn a file ahead, and mark it in /storylog archive', () => {
      const emptied = play(full(), 'NS.VOLUME_BYTES = 1');
      // The first file's session is now the oldest.
      expect(emptied.printed).toContain('when StoryLog_Archive5.lua is full, StoryLog_Archive1.lua will be emptied: 1 sessions');
      emptied.client.run('W.printed = {}; slash("archive")');
      const listed = emptied.client.printed();
      expect(listed).toContain('StoryLog_Archive1.lua: 1 sessions, 1 lines, about 0.0 MB, 21974 days ago (emptied when the one in use is full)');
      expect(listed).toContain('StoryLog_Archive5.lua: 2 sessions, 200 lines, about 0.0 MB, 21974 days ago (in use)');
      emptied.client.run('W.printed = {}; slash("status")');
      expect(emptied.client.printed()).toContain('StoryLog_Archive5.lua is in use, and StoryLog_Archive1.lua is emptied when it is full');
    });

    it('do again an emptying that the game did not save', () => {
      const emptied = play(full(), 'NS.VOLUME_BYTES = 1');
      // The main log was saved, and the archive file was not: it still holds the old sessions.
      const again = play({ ...emptied.files, [A5]: full()[A5]! });
      expect(again.printed).toContain('StoryLog_Archive5.lua was not saved with the sessions copied to it');
      expect(again.printed).toContain('StoryLog_Archive5.lua was emptied');
      expect(sessionsIn(again.files[A5])).toEqual(['one', 'two']);
      expect(sessionsIn(again.files.StoryLog)).toEqual(expect.arrayContaining(['one', 'two']));
      untouched(again.files);

      const after = play(again.files);
      expect(after.printed).toContain('2 older sessions are now in StoryLog_Archive5.lua');
      untouched(after.files);
    });

    it('count as empty after /storylog archive clear, once the player moved them away', () => {
      const emptied = play(full(), 'NS.VOLUME_BYTES = 1');
      const cleared = new Client({ files: { StoryLog: emptied.files.StoryLog! } })
        .login()
        .run('slash("archive clear")')
        .logoutAll();
      const fresh = play(cleared);
      expect(fresh.printed).toContain('copied to StoryLog_Archive1.lua');
      expect(fresh.printed).not.toContain('emptied');
    });

    it('count a file from before the bookkeeping had dates as the oldest', () => {
      const { client } = play(full(), 'NS.VOLUME_BYTES = 1');
      client.run('StoryLogDB.archive.held[7].oldest = nil; StoryLogDB.archive.held[7].newest = nil');
      expect(client.get('NS.archiveNext()')).toBe(7);
      client.run('W.printed = {}; slash("archive")');
      expect(client.printed()).toContain('StoryLog_Archive7.lua: 1 sessions, 1 lines, about 0.0 MB (emptied');
    });
  });

  it('are listed by /storylog archive without being loaded', () => {
    const { files } = play({ StoryLog: MAIN });
    const client = new Client({ files: { StoryLog: files.StoryLog! } });
    client.run(`W.addons.${A1}.disabled = true`).login().run('W.printed = {}; slash("archive")');
    const printed = client.printed();
    expect(printed).toContain('StoryLog_Archive1.lua: 2 sessions, 200 lines, about 0.0 MB, 21974 days ago (in use)');
    expect(printed).toContain('StoryLog_Archive2.lua: empty');
    expect(printed).toContain('StoryLog_Archive12.lua: empty');
    expect(printed).toContain('leave the main log at the next login');
  });

  it('follow /storylog limit, up to the size of an archive file', () => {
    const client = new Client().login();
    client.run('slash("limit 5")');
    expect(client.get('StoryLogDB.settings.limit')).toBe(5);
    for (const wrong of ['limit', 'limit 0.5', 'limit 9', 'limit 21', 'limit -1', 'limit lots']) client.run(`slash(${q(wrong)})`);
    expect(client.get('StoryLogDB.settings.limit')).toBe(5);
    expect(client.printed()).toContain('with 1 to 8');
    client.run('slash("limit off")');
    expect(client.get('StoryLogDB.settings.limit')).toBe(0);

    const off = play({ StoryLog: MAIN.replace('0.005', '0') });
    expect(off.printed).toBe('');
    expect(off.files[A1]).toBeUndefined();

    const large = new Client({ saved: 'StoryLogDB = { version = 1, settings = { limit = 20 } }' });
    expect(large.get('StoryLogDB.settings.limit')).toBe(8);
  });

  it('take the log when it holds too many different strings and numbers, whatever its size', () => {
    const { printed, files } = play({ StoryLog: MAIN.replace('0.005', '3') }, 'NS.LOG_CONSTANTS = 100');
    expect(printed).toContain('the log is close to the most that the game can load, so 2 sessions were copied');
    expect(sessionsIn(files[A1])).toEqual(['one', 'two']);
  });

  it.each([
    ['is never split', '0', '/storylog limit 3 splits it'],
    ['is split, but one long session holds too many', '3', '/reload, so that finished sessions can move'],
  ])('warn in the status when the log %s', (_name, limit, advice) => {
    const client = new Client({ saved: MAIN.replace('0.005', limit) }).login().run('NS.LOG_CONSTANTS = 100; slash("status")');
    expect(client.printed()).toContain('The log is close to the most that the game can load.');
    expect(client.printed()).toContain(advice);
  });

  it('say nothing of it while the log is well below', () => {
    const client = new Client({ saved: MAIN.replace('0.005', '3') }).login().run('slash("status")');
    expect(client.printed()).not.toContain('close to the most');
  });

  describe('from before there were twelve', () => {
    /** Five full files, from when there were five, and the fifth in use. */
    const FIVE = (() => {
      const held = Array.from({ length: 5 }, () => '{ sessions = 1, lines = 1, bytes = 10 }').join(', ');
      const files: Files = {
        StoryLog: `${MAIN}\nStoryLogDB.archive = { volume = 5, held = { ${held} } }`,
      };
      for (let volume = 1; volume <= 5; volume++) {
        files[`StoryLog_Archive${volume}`] =
          `StoryLogArchive${volume}DB = { version = 1, sessions = { { id = "old${volume}", started = ${400 + volume}, messages = { { t = ${400 + volume}, e = "SAY", m = "old" } } } } }`;
      }
      return files;
    })();

    it('go on to the sixth file, and empty none', () => {
      const next = play(FIVE, 'NS.VOLUME_BYTES = 1');
      expect(next.printed).toContain('2 sessions were copied to StoryLog_Archive6.lua');
      expect(next.printed).not.toContain('emptied');
      expect(next.client.get('StoryLogDB.archive.volume')).toBe(6);
      for (let volume = 1; volume <= 5; volume++) {
        expect(sessionsIn(next.files[`StoryLog_Archive${volume}`] ?? FIVE[`StoryLog_Archive${volume}`])).not.toContain('one');
      }
    });

    it('move nothing while the new files are not installed, and say which is missing', () => {
      const missing = Array.from({ length: 7 }, (_, index) => `W.addons.StoryLog_Archive${index + 6} = nil`).join('; ');
      const stuck = play(FIVE, `NS.VOLUME_BYTES = 1; ${missing}`);
      expect(stuck.printed).toContain("StoryLog_Archive6 can't be used (MISSING)");
      expect(stuck.client.get('StoryLogDB.archive.pending')).toBeNull();
      expect(sessionsIn(stuck.files.StoryLog)).toEqual(expect.arrayContaining(['one', 'two']));
    });
  });

  it('are sized by an estimate that is close to the real file', () => {
    const chatty = new Client().login();
    chatty.run('for i = 1, 300 do W.now = W.now + 1; chat("SAY", { text = ("word "):rep(i % 30), sender = "Borin Fixture", guid = "Player-1-B" }) end');
    const estimate = chatty.get<number>('NS.logSize()');
    const real = Buffer.byteLength(chatty.logout());
    expect(estimate / real).toBeGreaterThan(0.75);
    expect(estimate / real).toBeLessThan(1.25);
  });
});

describe('a log that the game did not load', () => {
  const SAVED_BEFORE = 'StoryLogCharDB = { saved = true }';

  it('is noticed, because the character has saved one before', () => {
    const client = new Client({ files: { character: SAVED_BEFORE } }).login();
    expect(client.printed()).toContain('the game did not load your saved log');
    expect(client.printed()).toContain('StoryLog.lua.bak');
  });

  it('is not suspected on a first login, or when the log is there', () => {
    const first = new Client().login();
    expect(first.printed()).toBe('');
    const files = first.run(ME).logoutAll();
    expect(files.character).toContain('["saved"] = true');
    expect(new Client({ files }).login().printed()).toBe('');
  });
});
