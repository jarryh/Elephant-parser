/**
 * What the StoryLog addon records besides chat: the group, trades, travel, fights,
 * dialogue windows, profiles and actions. Run against the simulated client in
 * tests/addon/mock.lua, which can't show that the game behaves as simulated.
 */
import { describe, expect, it } from 'vitest';
import { Client, q } from './addon/client';

interface Message {
  t: number;
  e: string;
  s?: number;
  to?: number;
  p?: number;
  [field: string]: unknown;
}
interface Speaker {
  name: string;
  [field: string]: unknown;
}
interface Session {
  messages: Message[];
  speakers: Speaker[];
  places: Record<string, unknown>[];
  clock?: number;
  holidays?: string[];
}

const session = (client: Client) => client.get<Session>('NS.session');
const lines = (client: Client, type: string) => session(client).messages.filter((message) => message.e === type);
/** The name of the speaker that a field points to. Lua counts from 1. */
const who = (client: Client, index: number | undefined) =>
  index === undefined ? undefined : session(client).speakers[index - 1]?.name;
const system = (text: string) => `chat("SYSTEM", { text = ${q(text)} })`;

const BORIN = 'W.units.party1 = { guid = "Player-1-B", first = "Borin", second = "Fixture" }';
const ROSTER = 'fire("GROUP_ROSTER_UPDATE")';
const CLOAK = '|cff1eff00|Hitem:12345::::::::70:::::|h[Fixture Cloak]|h|r';
const RAG = '|cff9d9d9d|Hitem:4|h[Torn Rag]|h|r';

describe('events', () => {
  it('are registered only when this client has them, and /storylog says which it lacks', () => {
    const client = new Client({ pre: 'NO_EVENT = { TRADE_SHOW = true, DUEL_REQUESTED = true }' }).login();
    client.run('slash("")');
    expect(client.printed()).toContain('Not on this client, so not recorded: DUEL_REQUESTED, TRADE_SHOW');
  });

  it('never include the combat log, which retail forbids', () => {
    const client = new Client().login();
    expect(client.get<string[]>('registeredEvents()')).not.toContain('COMBAT_LOG_EVENT_UNFILTERED');
    expect(client.get<string[]>('registeredEvents()')).toContain('PLAYER_REGEN_DISABLED');
  });

  it('follow their category', () => {
    const client = new Client().login().run('slash("record combat off"); fire("PLAYER_DEAD")');
    expect(lines(client, 'DEATH')).toEqual([]);
    client.run('slash("record combat on"); fire("PLAYER_DEAD")');
    expect(lines(client, 'DEATH')).toHaveLength(1);
  });

  it('are no session by themselves when they are only the group and the zone', () => {
    const client = new Client().login().run('W.zone = "Elwynn Forest"; fire("ZONE_CHANGED_NEW_AREA"); runTimers()');
    expect(lines(client, 'ZONE')).toHaveLength(1);
    expect(client.logout()).not.toContain('["messages"]');
  });
});

describe('the group', () => {
  it('says who leads, and a change of leader is a new line', () => {
    const client = new Client().login().run(`${BORIN}; W.leader = "party1"`).run(ROSTER);
    client.run(`W.now = W.now + 60; W.leader = "player"; fire("PARTY_LEADER_CHANGED")`);
    const groups = lines(client, 'GROUP');
    expect(groups.map((line) => who(client, line.lead as number))).toEqual(['Borin Fixture', 'Élowyn Testwood']);
  });

  it.each([
    ['You leave the group.', 'left'],
    ['Your group has been disbanded.', 'disbanded'],
    ['You have been removed from the group.', 'removed'],
  ])('says why it ended: %s', (text, why) => {
    const client = new Client().login().run(BORIN).run(ROSTER);
    client.run(`W.now = W.now + 60; ${system(text)}; W.units.party1 = nil`).run(ROSTER);
    expect(lines(client, 'GROUP').at(-1)).toMatchObject({ g: [], why });

    // The game may also empty the roster first and say why a moment later.
    const late = new Client().login().run(BORIN).run(ROSTER);
    late.run('W.now = W.now + 60; W.units.party1 = nil').run(ROSTER).run(`W.now = W.now + 1; ${system(text)}`);
    expect(lines(late, 'GROUP').at(-1)).toMatchObject({ g: [], why });
    expect(lines(late, 'GROUP')).toHaveLength(2);
  });

  it('does not take an old reason for a new ending, nor one for a group that still stands', () => {
    const client = new Client().login().run(BORIN).run(ROSTER);
    // Someone else leaves, with a message that is about you, long before you leave.
    client.run(`W.now = W.now + 60; ${system('Your group has been disbanded.')}`);
    client.run('W.now = W.now + 60; W.units.party1 = nil').run(ROSTER);
    expect(lines(client, 'GROUP').at(-1)).not.toHaveProperty('why');
    // And a reason long after the end belongs to nothing.
    client.run(`W.now = W.now + 60; ${system('You leave the group.')}`);
    expect(lines(client, 'GROUP').at(-1)).not.toHaveProperty('why');
  });

  it('keeps its leader while the game cannot say who leads', () => {
    const client = new Client().login().run(`${BORIN}; W.leader = "party1"`).run(ROSTER);
    client.run('W.now = W.now + 60; W.leader = nil').run(ROSTER);
    client.run('W.now = W.now + 60; W.leader = "party1"').run(ROSTER);
    expect(lines(client, 'GROUP')).toHaveLength(1);
  });

  it('saves invitations, and not also as notices', () => {
    const client = new Client().login().run('slash("record notices on")');
    client.run(system('You have invited Borin Fixture to join your group.'));
    client.run(system('|Hplayer:Cedra Mock|h[Cedra Mock]|h has invited you to join a group.'));
    client.run(system('Borin Fixture declines your group invitation.'));
    client.run(system('Borin Fixture joins the party.'));
    const invites = lines(client, 'INVITE');
    expect(invites.map((line) => [line.k, who(client, line.s), who(client, line.to)])).toEqual([
      ['out', 'Élowyn Testwood', 'Borin Fixture'],
      ['in', 'Cedra Mock', undefined],
      ['declined', 'Borin Fixture', undefined],
    ]);
    expect(lines(client, 'SYSTEM')).toEqual([]);
  });

  it("saves whom a member had targeted, as the game shows a member's target", () => {
    const client = new Client().login().run(BORIN).run(ROSTER);
    client.run('W.units.party1target = W.units.player');
    client.run('chat("SAY", { text = "You there!", sender = "Borin Fixture", guid = "Player-1-B" })');
    client.run('W.units.party1target = { guid = "Creature-0-1-0-1-77-1", first = "Guard Thomas" }');
    client.run('chat("PARTY", { text = "not addressed", sender = "Borin Fixture", guid = "Player-1-B" })');
    client.run('chat("EMOTE", { text = "salutes.", sender = "Borin Fixture", guid = "Player-1-B" })');
    const said = session(client).messages.filter((line) => line.m);
    expect(said.map((line) => who(client, line.to))).toEqual(['Élowyn Testwood', undefined, 'Guard Thomas']);
  });
});

describe('trades', () => {
  const OPEN = 'W.units.npc = { guid = "Player-1-B", first = "Borin", second = "Fixture" }; fire("TRADE_SHOW")';

  const OFFER = `W.trade = { mine = { { link = ${q(CLOAK)}, count = 2 } }, theirs = {}, theirMoney = 12345 }`;
  /** Both accept, and the window empties and closes, which the game reports twice. */
  const ACCEPTED = 'fire("TRADE_ACCEPT_UPDATE", 1, 1); W.trade = nil; fire("TRADE_PLAYER_ITEM_CHANGED", 1); fire("TRADE_CLOSED"); fire("TRADE_CLOSED")';

  it('save what each side gave, once both accepted and the game said nothing against it', () => {
    const client = new Client().login().run(OPEN).run(OFFER);
    client.run('fire("TRADE_PLAYER_ITEM_CHANGED", 1); fire("TRADE_MONEY_CHANGED")').run(ACCEPTED);
    // Not yet: it can still fail.
    expect(lines(client, 'TRADE')).toEqual([]);
    client.run('runTimers(); runTimers()');
    const [trade] = lines(client, 'TRADE');
    expect(trade).toMatchObject({ a: [{ link: CLOAK, count: 2 }], bm: 12345 });
    expect(trade).not.toHaveProperty('b');
    expect(who(client, trade!.to)).toBe('Borin Fixture');
    expect(lines(client, 'TRADE')).toHaveLength(1);
  });

  it('are saved at once when the game says that the trade is complete, and once', () => {
    const client = new Client().login().run(OPEN).run(OFFER).run('fire("TRADE_PLAYER_ITEM_CHANGED", 1)').run(ACCEPTED);
    client.run('fire("UI_INFO_MESSAGE", 272, "Trade complete.")');
    expect(lines(client, 'TRADE')).toHaveLength(1);
    client.run('runTimers()');
    expect(lines(client, 'TRADE')).toHaveLength(1);
  });

  it('are not saved when they fail after both accepted, as with full bags', () => {
    const client = new Client().login().run(OPEN).run(OFFER).run('fire("TRADE_PLAYER_ITEM_CHANGED", 1)').run(ACCEPTED);
    client.run('fire("UI_ERROR_MESSAGE", 50, "Trade failed, you don\'t have enough space."); runTimers()');
    expect(lines(client, 'TRADE')).toEqual([]);
  });

  it('take a new look when an acceptance is taken back', () => {
    const client = new Client().login().run(OPEN).run(OFFER).run('fire("TRADE_PLAYER_ITEM_CHANGED", 1); fire("TRADE_ACCEPT_UPDATE", 1, 1)');
    client.run(`fire("TRADE_ACCEPT_UPDATE", 0, 0); W.trade.mine[1].count = 5; fire("TRADE_PLAYER_ITEM_CHANGED", 1)`).run(ACCEPTED);
    client.run('runTimers()');
    expect(lines(client, 'TRADE')).toMatchObject([{ a: [{ link: CLOAK, count: 5 }] }]);
  });

  it('name an item whose link the game has not loaded', () => {
    const client = new Client().login().run(OPEN).run('W.trade = { theirs = { { name = "Old Key" } } }; fire("TRADE_TARGET_ITEM_CHANGED", 1)');
    client.run(ACCEPTED).run('runTimers()');
    expect(lines(client, 'TRADE')).toMatchObject([{ b: [{ link: '[Old Key]' }] }]);
  });

  it('keep nobody while items are not recorded', () => {
    const client = new Client().login().run('slash("record items off")').run(OPEN).run(OFFER).run(ACCEPTED).run('runTimers()');
    expect(session(client).speakers).toEqual([]);
    expect(lines(client, 'TRADE')).toEqual([]);
  });

  it('are saved when the game says the trade went through', () => {
    const client = new Client().login().run(OPEN);
    client.run(`W.trade = { theirs = { { link = ${q(CLOAK)} } } }; fire("TRADE_TARGET_ITEM_CHANGED", 1)`);
    client.run('fire("TRADE_CLOSED"); fire("UI_INFO_MESSAGE", 272, "Trade complete.")');
    expect(lines(client, 'TRADE')).toMatchObject([{ b: [{ link: CLOAK }] }]);
  });

  it('are not saved when cancelled, or when the game hides what is in the window', () => {
    const cancelled = new Client().login().run(OPEN);
    cancelled.run(`W.trade = { mine = { { link = ${q(CLOAK)} } } }; fire("TRADE_PLAYER_ITEM_CHANGED", 1); fire("TRADE_CLOSED")`);
    cancelled.run('W.now = W.now + 60; fire("UI_INFO_MESSAGE", 272, "Trade complete.")');
    expect(lines(cancelled, 'TRADE')).toEqual([]);

    const hidden = new Client().login().run(`W.allSecret = true; ${OPEN}`);
    hidden.run(`W.trade = { mine = { { link = ${q(CLOAK)} } } }; fire("TRADE_PLAYER_ITEM_CHANGED", 1)`);
    hidden.run('fire("TRADE_ACCEPT_UPDATE", 1, 1); fire("TRADE_CLOSED"); runTimers()');
    expect(lines(hidden, 'TRADE')).toEqual([]);
    expect(hidden.get('NS.failures.count')).toBe(0);
  });
});

describe('items', () => {
  it('that you loot, get or make are saved, and nobody else’s', () => {
    const client = new Client().login();
    client.run(`chat("LOOT", { text = ${q(`You receive loot: ${RAG}x3.`)} })`);
    client.run(`chat("LOOT", { text = ${q(`You receive item: ${CLOAK}.`)} })`);
    client.run(`chat("LOOT", { text = ${q(`You create: ${CLOAK}.`)} })`);
    client.run(`chat("LOOT", { text = ${q(`Borin Fixture receives loot: ${CLOAK}.`)} })`);
    expect(lines(client, 'ITEM').map(({ k, m, n }) => [k, m, n])).toEqual([
      ['loot', RAG, 3],
      ['got', CLOAK, undefined],
      ['made', CLOAK, undefined],
    ]);
    expect(lines(client, 'LOOT')).toEqual([]);
  });

  it('are not saved twice with notices on', () => {
    const client = new Client().login().run('slash("record notices on")');
    client.run(`chat("LOOT", { text = ${q(`You receive loot: ${CLOAK}.`)} })`);
    client.run(`chat("LOOT", { text = ${q(`Borin Fixture receives loot: ${CLOAK}.`)} })`);
    expect(session(client).messages.map((line) => line.e)).toEqual(['ITEM', 'LOOT']);
  });
});

describe('letters', () => {
  it('that you send are saved once the game has sent them', () => {
    const client = new Client().login();
    client.run(`W.outgoing = { items = { { link = ${q(CLOAK)} } }, money = 500 }`);
    client.run('SendMail("Borin Fixture", "Your cloak", "Dear Borin,\\nhere it is.")');
    expect(lines(client, 'MAIL')).toEqual([]);
    client.run('fire("MAIL_SEND_SUCCESS")');
    expect(lines(client, 'MAIL')).toMatchObject([
      { k: 'sent', who: 'Borin Fixture', m: 'Your cloak', text: 'Dear Borin,\nhere it is.', a: [{ link: CLOAK }], am: 500 },
    ]);
  });

  it('that you open are saved once, and not those from the game', () => {
    const client = new Client().login();
    client.run(String.raw`
      W.inbox[1] = { sender = "Borin Fixture", subject = "Thanks", body = "It fits.", money = 0 }
      W.inbox[2] = { sender = "Auction House", subject = "Sold", body = "", canReply = false }
      InboxFrame_OnClick(nil, 1); InboxFrame_OnClick(nil, 1); InboxFrame_OnClick(nil, 2)
    `);
    expect(lines(client, 'MAIL')).toMatchObject([{ k: 'read', who: 'Borin Fixture', m: 'Thanks', text: 'It fits.' }]);
  });
});

describe('travel', () => {
  it('saves a new zone, and a part of one where you stay', () => {
    const client = new Client().login().run('W.zone = "Elwynn Forest"; fire("ZONE_CHANGED_NEW_AREA"); runTimers()');
    // Back and forth to the same place is nothing new.
    client.run('fire("ZONE_CHANGED_NEW_AREA"); runTimers()');
    client.run('W.sub = "Goldshire"; fire("ZONE_CHANGED"); runTimers()');
    // Passing through.
    client.run('W.sub = "Lion\'s Pride Inn"; fire("ZONE_CHANGED"); W.sub = "Goldshire"; runTimers()');
    const zones = lines(client, 'ZONE').map((line) => session(client).places[line.p! - 1]);
    expect(zones).toMatchObject([{ zone: 'Elwynn Forest' }, { zone: 'Elwynn Forest', sub: 'Goldshire' }]);
  });

  it('saves a new zone after a second, whichever way round the game reports it and its first part', () => {
    for (const events of ['fire("ZONE_CHANGED_NEW_AREA"); fire("ZONE_CHANGED")', 'fire("ZONE_CHANGED"); fire("ZONE_CHANGED_NEW_AREA")']) {
      const client = new Client().login().run(`W.zone = "Westfall"; W.sub = "Sentinel Hill"; ${events}; runTimers(1)`);
      expect(lines(client, 'ZONE')).toHaveLength(1);
      // The part of the zone is the same place, twenty seconds later.
      client.run('runTimers(20)');
      expect(lines(client, 'ZONE')).toHaveLength(1);
    }
  });

  it('saves a flight where it lands, and no zones on the way', () => {
    const client = new Client().login().run('W.zone = "Stormwind City"');
    client.run('fire("PLAYER_CONTROL_LOST"); W.taxi = true; runTimers()');
    client.run('W.zone = "Dun Morogh"; fire("ZONE_CHANGED_NEW_AREA"); runTimers()');
    client.run('W.now = W.now + 300; W.zone = "Ironforge"; W.taxi = false; fire("PLAYER_CONTROL_GAINED"); runTimers()');
    expect(lines(client, 'ZONE')).toEqual([]);
    const [flight] = lines(client, 'TRAVEL');
    const { places } = session(client);
    expect(flight).toMatchObject({ k: 'flight', n: 300 });
    expect([places[(flight!.from as number) - 1], places[flight!.p! - 1]]).toMatchObject([
      { zone: 'Stormwind City' },
      { zone: 'Ironforge' },
    ]);
  });

  it('saves a summons that you accept', () => {
    const client = new Client().login().run('W.summoner = "Borin Fixture"; W.summonArea = "The Deadmines"');
    client.run('fire("CONFIRM_SUMMON"); C_SummonInfo.ConfirmSummon()');
    const [summons] = lines(client, 'TRAVEL');
    expect(summons).toMatchObject({ k: 'summon', m: 'The Deadmines' });
    expect(who(client, summons!.s)).toBe('Borin Fixture');
  });
});

describe('fights', () => {
  const THUG = 'W.units.target = { guid = "Creature-0-1-0-1-99-1", first = "Defias Thug", hostile = true }';

  it('are one line with whom you fought, also when one follows another', () => {
    const client = new Client().login().run(THUG).run('fire("PLAYER_REGEN_DISABLED"); W.now = W.now + 20; fire("PLAYER_REGEN_ENABLED")');
    client.run('W.now = W.now + 10; fire("PLAYER_REGEN_DISABLED")');
    client.run('W.units.target = { guid = "Creature-0-1-0-1-98-1", first = "Defias Bandit", hostile = true }; fire("PLAYER_TARGET_CHANGED")');
    client.run('W.units.target = { guid = "Player-1-B", first = "Borin", second = "Fixture" }; fire("PLAYER_TARGET_CHANGED")');
    client.run('W.now = W.now + 10; fire("PLAYER_REGEN_ENABLED")');
    expect(lines(client, 'FIGHT')).toMatchObject([{ n: 40, foes: ['Defias Thug', 'Defias Bandit'] }]);

    // After something else, it is another fight.
    client.run('fire("PLAYER_DEAD"); fire("PLAYER_REGEN_DISABLED"); fire("PLAYER_REGEN_ENABLED")');
    expect(lines(client, 'FIGHT')).toHaveLength(2);
  });

  it('with a boss say how they ended', () => {
    const client = new Client().login().run('fire("ENCOUNTER_START", 1, "Hogger", 1, 5)');
    client.run('W.now = W.now + 90; fire("ENCOUNTER_END", 1, "Hogger", 1, 5, 1)');
    expect(lines(client, 'ENCOUNTER')).toMatchObject([{ m: 'Hogger', id: 1, won: true, n: 90 }]);
  });

  it('end in death, and in coming back, by someone or at the corpse', () => {
    const client = new Client().login();
    client.run('fire("PLAYER_DEAD"); W.dead = true; fire("RESURRECT_REQUEST", "Borin Fixture"); W.dead = false; fire("PLAYER_ALIVE")');
    // Releasing the spirit makes you a ghost, which is not being back.
    client.run('fire("PLAYER_DEAD"); W.dead = true; fire("PLAYER_ALIVE"); W.dead = false; fire("PLAYER_UNGHOST")');
    const told = session(client).messages.map((line) => [line.e, who(client, line.s)]);
    expect(told).toEqual([
      ['DEATH', 'Élowyn Testwood'],
      ['REVIVED', 'Borin Fixture'],
      ['DEATH', 'Élowyn Testwood'],
      ['REVIVED', undefined],
    ]);
  });

  it('include duels, yours and those of others nearby', () => {
    const client = new Client().login().run('fire("DUEL_REQUESTED", "Borin Fixture")');
    client.run(system('Borin Fixture has defeated Élowyn Testwood in a duel'));
    client.run(system('Cedra Mock has fled from Borin Fixture in a duel'));
    client.run('W.units.target = { guid = "Player-1-C", first = "Cedra", second = "Mock" }; StartDuel("target")');
    // With /duel it is a name. Without a target there is nobody.
    client.run('W.units.target = nil; StartDuel("Dorn Placeholder"); StartDuel("target"); StartDuel()');
    const duels = lines(client, 'DUEL').map((line) => [line.k, who(client, line.s), who(client, line.to)]);
    expect(duels).toEqual([
      ['challenge', 'Borin Fixture', 'Élowyn Testwood'],
      ['won', 'Borin Fixture', 'Élowyn Testwood'],
      ['fled', 'Borin Fixture', 'Cedra Mock'],
      ['challenge', 'Élowyn Testwood', 'Cedra Mock'],
      ['challenge', 'Élowyn Testwood', 'Dorn Placeholder'],
    ]);
  });

  it('can bring a new level', () => {
    const client = new Client().login().run('fire("PLAYER_LEVEL_UP", 12)');
    expect(lines(client, 'LEVEL')).toMatchObject([{ n: 12 }]);
  });
});

describe('NPCs', () => {
  const GATEKEEPER = 'W.units.npc = { guid = "Creature-0-1-0-1-90001-1", first = "Gatekeeper Dummy" }';
  const WINDOW = `${GATEKEEPER}; W.gossip = { text = "Halt! Who goes there?", options = { "A friend.", "Goodbye." } }`;

  it('are saved for what they say in their window, once, and for the answer chosen', () => {
    const client = new Client().login().run(WINDOW).run('fire("GOSSIP_SHOW"); fire("GOSSIP_SHOW")');
    client.run('C_GossipInfo.SelectOption(101); C_GossipInfo.SelectOptionByIndex(1)');
    const [said, ...answers] = session(client).messages;
    expect(said).toMatchObject({ e: 'GOSSIP', m: 'Halt! Who goes there?' });
    expect(who(client, said!.s)).toBe('Gatekeeper Dummy');
    expect(answers.map((line) => [line.e, line.m, who(client, line.to)])).toEqual([
      ['CHOICE', 'A friend.', 'Gatekeeper Dummy'],
      ['CHOICE', 'Goodbye.', 'Gatekeeper Dummy'],
    ]);
  });

  it('give quests their text', () => {
    const client = new Client().login().run('W.quests[7] = { title = "Pelts", inLog = true }').run(GATEKEEPER);
    client.run('W.window = { id = 7, text = "Bring me pelts, $N.", goal = "10 pelts" }; fire("QUEST_DETAIL"); fire("QUEST_ACCEPTED", 7)');
    client.run('W.window = { id = 7, reward = "Well done." }; fire("QUEST_COMPLETE"); fire("QUEST_TURNED_IN", 7, 0, 0)');
    // A window of another quest says nothing about this one.
    client.run('W.window = { id = 8, text = "Other." }; fire("QUEST_DETAIL"); W.quests[9] = { inLog = true }; fire("QUEST_ACCEPTED", 9)');
    expect(session(client).messages.map(({ q: quest, text, goal }) => [quest, text, goal])).toEqual([
      [7, 'Bring me pelts, $N.', '10 pelts'],
      [7, 'Well done.', undefined],
      [9, undefined, undefined],
    ]);
  });

  it('give a quest the text of its own window only', () => {
    // A client whose window has no quest number: the title has to match.
    const setup = 'GetQuestID = nil; W.quests[7] = { title = "Pelts", inLog = true }; W.quests[8] = { title = "Hides", inLog = true }';
    const declined = new Client().login().run(setup);
    declined.run('W.window = { title = "Pelts", text = "Bring me pelts." }; fire("QUEST_DETAIL"); fire("QUEST_ACCEPTED", 8)');
    expect(session(declined).messages[0]).not.toHaveProperty('text');

    const taken = new Client().login().run(setup);
    taken.run('W.window = { title = "Pelts", text = "Bring me pelts." }; fire("QUEST_DETAIL"); fire("QUEST_ACCEPTED", 7)');
    expect(session(taken).messages[0]).toMatchObject({ q: 7, text: 'Bring me pelts.' });

    // Neither a number nor a title: nothing says whose text it is.
    const unknown = new Client().login().run(setup);
    unknown.run('W.window = { text = "Bring me pelts." }; fire("QUEST_DETAIL"); fire("QUEST_ACCEPTED", 7)');
    expect(session(unknown).messages[0]).not.toHaveProperty('text');
  });

  it('are still known for a quest that the quest log only showed after login', () => {
    const client = new Client().login().run('W.quests[5] = { title = "Old", inLog = true }').run(ROSTER);
    client.run('fire("QUEST_TURNED_IN", 5, 0, 0)');
    expect(session(client).messages).toMatchObject([{ e: 'QUEST_TURNED_IN', q: 5 }]);
  });

  it('give no quest text with NPC text off', () => {
    const client = new Client().login().run('slash("record npc off"); W.quests[7] = { title = "Pelts", inLog = true }');
    client.run('W.window = { id = 7, text = "Bring me pelts." }; fire("QUEST_DETAIL"); fire("QUEST_ACCEPTED", 7)');
    expect(session(client).messages).toMatchObject([{ e: 'QUEST_ACCEPTED', q: 7 }]);
    expect(session(client).messages[0]).not.toHaveProperty('text');
  });

  it('include books and plaques, a page at a time', () => {
    const client = new Client().login().run('W.book = { title = "A Plaque", pages = { "Here lies Arthur.", "Page two." } }');
    client.run('fire("ITEM_TEXT_READY"); fire("ITEM_TEXT_READY"); W.book.page = 2; fire("ITEM_TEXT_READY")');
    expect(lines(client, 'READ').map(({ m, n, text }) => [m, n, text])).toEqual([
      ['A Plaque', undefined, 'Here lies Arthur.'],
      ['A Plaque', 2, 'Page two.'],
    ]);
  });
});

describe('profiles', () => {
  const PROFILE = String.raw`
    W.rp["Borin Fixture"] = "Borin Ironvow"
    W.profiles["Borin Fixture"] = {
      characteristics = { FT = "Captain of the Gate", RA = "Mountain Dwarf", AG = "45", EC = "Grey", HE = "Short", WE = "Stout" },
      character = { CU = "Guarding the gate" },
      misc = { PE = { ["1"] = { AC = true, TI = "Scar", TX = "Across the cheek" }, ["2"] = { AC = false, TI = "Hidden" } } },
      about = { TE = 3, T3 = { PH = { TX = "Broad shoulders, {col:ff0000}red{/col} beard" } } },
      pronouns = "he/him", guild = "Ironforge Watch",
    }
  `;
  const BORIN_SAYS = 'chat("SAY", { text = "Halt.", sender = "Borin Fixture", guid = "Player-1-B" })';

  it('give what a player wrote about their character', () => {
    const client = new Client({ pre: 'TRP = true' }).login().run(PROFILE).run(BORIN_SAYS);
    expect(session(client).speakers[0]).toEqual({
      name: 'Borin Fixture',
      guid: 'Player-1-B',
      rp: 'Borin Ironvow',
      title: 'Captain of the Gate',
      rpRace: 'Mountain Dwarf',
      pron: 'he/him',
      age: '45',
      eyes: 'Grey',
      height: 'Short',
      build: 'Stout',
      now: 'Guarding the gate',
      glance: 'Scar: Across the cheek',
      look: 'Broad shoulders, {col:ff0000}red{/col} beard',
      guild: 'Ironforge Watch',
    });
  });

  it('are read again after a while, and a new "currently" keeps the earlier lines as they were', () => {
    const client = new Client({ pre: 'TRP = true' }).login().run(PROFILE).run(BORIN_SAYS);
    client.run('W.profiles["Borin Fixture"].characteristics.AG = "46"; W.now = W.now + 10').run(BORIN_SAYS);
    expect(session(client).speakers[0]!.age).toBe('45');
    client.run('W.profiles["Borin Fixture"].character.CU = "Off duty"; W.now = W.now + 30').run(BORIN_SAYS);
    expect(session(client).speakers.map(({ now, age }) => [now, age])).toEqual([
      ['Guarding the gate', '45'],
      ['Off duty', '46'],
    ]);
    expect(session(client).messages.map((line) => line.s)).toEqual([1, 1, 2]);
  });

  it('keep earlier lines as they were when "currently" is taken away and set again', () => {
    const client = new Client({ pre: 'TRP = true' }).login().run(PROFILE).run(BORIN_SAYS);
    client.run('W.profiles["Borin Fixture"].character.CU = nil; W.now = W.now + 31').run(BORIN_SAYS);
    client.run('W.profiles["Borin Fixture"].character.CU = "Off duty"; W.now = W.now + 31').run(BORIN_SAYS);
    // What was said under "Guarding the gate" keeps it. An empty one fills in, as a late profile does.
    expect(session(client).speakers.map((speaker) => speaker.now)).toEqual(['Guarding the gate', 'Off duty']);
    expect(session(client).messages.map((line) => line.s)).toEqual([1, 2, 2]);
    // The rest of the profile came along.
    expect(session(client).speakers[1]).toMatchObject({ title: 'Captain of the Gate', age: '45' });
  });

  it('keep a guild that the game showed, after they left the group', () => {
    const client = new Client().login().run(`${BORIN}; W.units.party1.guild = "The Watch"`).run(ROSTER).run(BORIN_SAYS);
    client.run('W.now = W.now + 60; W.units.party1 = nil').run(ROSTER).run(BORIN_SAYS);
    expect(session(client).speakers[0]).toMatchObject({ guild: 'The Watch' });
  });

  it('say when a line was out of character', () => {
    const client = new Client({ pre: 'TRP = true' }).login().run(PROFILE).run(BORIN_SAYS);
    client.run('W.status["Borin Fixture"] = 2').run(BORIN_SAYS).run('W.status["Borin Fixture"] = 1').run(BORIN_SAYS);
    expect(session(client).messages.map((line) => line.ooc)).toEqual([undefined, true, undefined]);
  });

  it('are left alone with profiles off, but not the roleplay name', () => {
    const client = new Client({ pre: 'TRP = true' }).login().run('slash("record profiles off")').run(PROFILE);
    client.run('W.status["Borin Fixture"] = 2').run(BORIN_SAYS);
    expect(session(client).speakers[0]).toEqual({ name: 'Borin Fixture', guid: 'Player-1-B', rp: 'Borin Ironvow' });
    expect(session(client).messages[0]).not.toHaveProperty('ooc');
  });

  it('give the guild that the game shows, without Total RP 3', () => {
    const client = new Client().login().run(`${BORIN}; W.units.party1.guild = "The Watch"`).run(ROSTER).run(BORIN_SAYS);
    expect(session(client).speakers[0]).toMatchObject({ name: 'Borin Fixture', guild: 'The Watch' });
  });
});

describe('actions', () => {
  const cast = (id: number, guid: string, target = '') =>
    `fire("UNIT_SPELLCAST_SENT", "player", ${q(target)}, ${q(guid)}, ${id}); fire("UNIT_SPELLCAST_SUCCEEDED", "player", ${q(guid)}, ${id})`;

  it('are the spells you cast out of combat, a repeat counted on the first', () => {
    const client = new Client().login().run('W.spells[8690] = "Hearthstone"; W.spells[2061] = "Flash Heal"; W.mounts[458] = 1; W.spells[458] = "Brown Horse"');
    client.run(cast(8690, 'Cast-1')).run('W.now = W.now + 30').run(cast(8690, 'Cast-2'));
    client.run('W.units.target = { guid = "Player-1-B", first = "Borin", second = "Fixture" }').run(cast(2061, 'Cast-3', 'Borin'));
    client.run(cast(458, 'Cast-4'));
    // Not started by you, as part of another spell; and in combat.
    client.run('fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-5", 2061)');
    client.run('W.combat = true').run(cast(2061, 'Cast-6', 'Borin'));
    expect(lines(client, 'CAST').map(({ m, n, to, mount }) => [m, n, who(client, to), mount])).toEqual([
      ['Hearthstone', 2, undefined, undefined],
      ['Flash Heal', undefined, 'Borin Fixture', undefined],
      ['Brown Horse', undefined, undefined, true],
    ]);
  });

  it('start a new line when a spell is cast again and again for longer than a minute', () => {
    const client = new Client().login().run('W.spells[2061] = "Flash Heal"');
    for (let n = 1; n <= 5; n++) client.run(cast(2061, `Cast-${n}`)).run('W.now = W.now + 25');
    expect(lines(client, 'CAST').map((line) => line.n)).toEqual([3, 2]);
  });

  it('are every spell you cast on a client that cannot tell which you started', () => {
    const client = new Client({ pre: 'NO_EVENT = { UNIT_SPELLCAST_SENT = true }' }).login().run('W.spells[8690] = "Hearthstone"');
    client.run('fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-1", 8690)');
    expect(lines(client, 'CAST')).toMatchObject([{ m: 'Hearthstone' }]);
  });

  it('include changing clothes, once you stop', () => {
    const client = new Client().run('W.worn[5] = "Chest A"; W.worn[11] = "Ring"').login();
    client.run('W.worn[5] = "Chest B"; W.worn[1] = "Hat"; fire("PLAYER_EQUIPMENT_CHANGED", 5); fire("PLAYER_EQUIPMENT_CHANGED", 1)');
    // Rings can't be seen.
    client.run('W.worn[11] = "Other ring"; fire("PLAYER_EQUIPMENT_CHANGED", 11); runTimers()');
    expect(lines(client, 'OUTFIT')).toMatchObject([{ on: ['Hat', 'Chest B'], off: ['Chest A'] }]);
  });

  it('do not count boots that the game had not loaded at login as put on', () => {
    const client = new Client().login().run('W.worn[8] = "Boots"; W.worn[10] = "Gloves"; fire("PLAYER_EQUIPMENT_CHANGED", 10); runTimers()');
    expect(lines(client, 'OUTFIT')).toMatchObject([{ on: ['Gloves'] }]);
  });
});

describe('the session', () => {
  it("knows the game world's time when it starts", () => {
    const client = new Client().run('W.gameTime = { 19, 40 }').login();
    expect(session(client).clock).toBe(19 * 60 + 40);
  });

  it('knows the festivals of the day, once the calendar is read', () => {
    const client = new Client({ pre: 'CALENDAR = true' }).run('W.calendarMonth = 9').login();
    expect(session(client).holidays).toBeUndefined();
    expect(client.get('W.calendarAsked')).toBe(true);
    client.run('W.calendarMonth = 10; W.holidays = { { title = "Hallow\'s End" }, { title = "Raid night", kind = "GUILD_EVENT" } }');
    client.run('fire("CALENDAR_UPDATE_EVENT_LIST")');
    expect(session(client).holidays).toEqual(["Hallow's End"]);
  });

  it('does not take a calendar that has not answered yet for a day without festivals', () => {
    // The right month, and nothing in it so far.
    const client = new Client({ pre: 'CALENDAR = true' }).login();
    expect(session(client).holidays).toBeUndefined();
    expect(client.get('W.calendarAsked')).toBe(true);
    client.run('W.holidays = { { title = "Midsummer" } }; fire("CALENDAR_UPDATE_EVENT_LIST")');
    expect(session(client).holidays).toEqual(['Midsummer']);
  });

  it('starts when the game hides the wording of a dice roll', () => {
    const client = new Client({ pre: 'ROLL_FORMAT = "%s rolls %d (%d-%d)"' });
    client.run('RANDOM_ROLL_RESULT = newSecret()').login().run('chat("SYSTEM", { text = "Ann rolls 5 (1-6)" })');
    expect(session(client).messages).toEqual([]);
    expect(client.get('NS.failures.count')).toBe(0);
  });
});

describe('hidden values', () => {
  it('never reach the saved file from any of these sources', () => {
    const client = new Client({ pre: 'TRP = true; CALENDAR = true' }).run('W.gameTime = { 1, 2 }').login().run('W.allSecret = true');
    client.run(String.raw`
      W.units.npc = { guid = "Creature-0-1-0-1-90001-1", first = "Gatekeeper Dummy" }
      W.gossip = { text = "Halt!", options = { "A friend." } }
      fire("GOSSIP_SHOW"); C_GossipInfo.SelectOption(101)
      W.book = { title = "T", pages = { "x" } }; fire("ITEM_TEXT_READY")
      W.window = { id = 7, text = "t" }; fire("QUEST_DETAIL")
      W.units.target = { guid = "Creature-0-1-0-1-99-1", first = "Thug", hostile = true }
      fire("PLAYER_REGEN_DISABLED"); fire("PLAYER_REGEN_ENABLED")
      fire("ENCOUNTER_START", 1, "Hogger"); fire("ENCOUNTER_END", 1, "Hogger", 1, 5, 1)
      W.summoner = "B"; W.summonArea = "A"; fire("CONFIRM_SUMMON"); C_SummonInfo.ConfirmSummon()
      W.inbox[1] = { sender = "B", subject = "S", body = "B" }; InboxFrame_OnClick(nil, 1)
      W.worn[1] = "Hat"; fire("PLAYER_EQUIPMENT_CHANGED", 1); runTimers()
      W.spells[1] = "Spell"; fire("UNIT_SPELLCAST_SENT", "player", "", "C-1", 1); fire("UNIT_SPELLCAST_SUCCEEDED", "player", "C-1", 1)
      fire("CALENDAR_UPDATE_EVENT_LIST")
    `);
    // The serializer throws on a hidden value.
    expect(client.logout()).toContain('ENCOUNTER');
    expect(client.get('NS.failures.count')).toBe(0);
  });
});

describe('the size of the log', () => {
  it('is estimated closely with every kind of line', () => {
    const client = new Client({ pre: 'TRP = true' }).login();
    client.run(String.raw`
      W.units.npc = { guid = "Creature-0-1-0-1-90001-1", first = "Gatekeeper Dummy" }
      for i = 1, 100 do
        W.now = W.now + 100
        W.gossip = { text = ("Words "):rep(i % 20) .. i }; fire("GOSSIP_SHOW")
        fire("PLAYER_REGEN_DISABLED"); fire("PLAYER_REGEN_ENABLED")
        W.book = { title = "Book " .. i, pages = { ("Lines "):rep(i % 30) } }; fire("ITEM_TEXT_READY")
        chat("SAY", { text = ("word "):rep(i % 30), sender = "Borin Fixture", guid = "Player-1-B" })
      end
    `);
    const estimate = client.get<number>('NS.logSize()');
    const real = Buffer.byteLength(client.logout());
    expect(estimate / real).toBeGreaterThan(0.85);
    expect(estimate / real).toBeLessThan(1.15);
  });
});
