/**
 * What the player can switch in the StoryLog addon: kinds of speech, channels by name,
 * and the window that /storylog opens. Run against the simulated client in
 * tests/addon/mock.lua, which can't show how the window looks in the game.
 */
import { describe, expect, it } from 'vitest';
import { Client, q } from './addon/client';

interface Message {
  e: string;
  m?: string;
  ch?: string;
}

const messages = (client: Client) => client.get<Message[]>('NS.session.messages');
const said = (client: Client) => messages(client).map((message) => message.m);
const settings = (client: Client) => client.get<Record<string, unknown>>('StoryLogDB.settings');
const chat = (kind: string, text: string, extra = '') =>
  `chat(${q(kind)}, { text = ${q(text)}, sender = "Borin Fixture", guid = "Player-1-B"${extra} })`;
/** A line in a numbered channel, as the game names it in its fourth and ninth arguments. */
const inChannel = (text: string, base: string, channel = '') =>
  chat('CHANNEL', text, `, base = ${q(base)}, channel = ${q(channel)}`);

const SPEECH: Record<string, string[]> = {
  speech: ['SAY', 'YELL', 'EMOTE', 'TEXT_EMOTE'],
  party: ['PARTY', 'PARTY_LEADER', 'RAID', 'RAID_LEADER', 'RAID_WARNING', 'INSTANCE_CHAT', 'INSTANCE_CHAT_LEADER'],
  whispers: ['WHISPER', 'WHISPER_INFORM', 'BN_WHISPER', 'BN_WHISPER_INFORM'],
  creatures: ['MONSTER_SAY', 'MONSTER_YELL', 'MONSTER_EMOTE', 'MONSTER_WHISPER', 'MONSTER_PARTY', 'RAID_BOSS_EMOTE', 'RAID_BOSS_WHISPER'],
};
const CHANNELS = 'W.channels = { { 1, "General - Elwynn Forest" }, { 2, "Trade - City", false } }';

describe('kinds of speech', () => {
  it.each(Object.keys(SPEECH))('leave out only their own lines when %s is off', (off) => {
    const client = new Client().login().run(`slash("record ${off} off")`);
    for (const kind of Object.values(SPEECH).flat()) client.run(chat(kind, kind));
    const expected = Object.entries(SPEECH)
      .filter(([category]) => category !== off)
      .flatMap(([, kinds]) => kinds);
    expect(messages(client).map((message) => message.e)).toEqual(expected);
  });

  it('are on by default', () => {
    expect(settings(new Client().login())).toMatchObject({ speech: true, party: true, whispers: true, creatures: true });
  });

  it('follow what speech was in a log from before they had switches of their own', () => {
    const off = new Client({ saved: 'StoryLogDB = { version = 1, settings = { speech = false } }' }).login();
    expect(settings(off)).toMatchObject({ speech: false, party: false, whispers: false, creatures: false });

    const mixed = new Client({ saved: 'StoryLogDB = { version = 1, settings = { speech = false, whispers = true } }' });
    expect(settings(mixed.login())).toMatchObject({ speech: false, party: false, whispers: true, creatures: false });
  });
});

describe('channels', () => {
  it.each([
    ['2. General - Elwynn Forest', 'general', 'General'],
    ['General - Stormwind City', 'general', 'General'],
    ['Trade - English 38', 'trade', 'Trade'],
    ['Trade (Services) - City', 'trade (services)', 'Trade (Services)'],
    ['  5. MyRP  ', 'myrp', 'MyRP'],
    ['RP-Channel', 'rp-channel', 'RP-Channel'],
  ])('are one switch for every zone and number: %j is %j', (name, key, shown) => {
    const client = new Client();
    expect(client.get(`{ NS.channelKey(${q(name)}) }`)).toEqual([key, shown]);
  });

  it('have no switch without a name', () => {
    const client = new Client();
    expect(client.get('NS.channelKey("")')).toBeNull();
    expect(client.get('NS.channelKey("3. ")')).toBeNull();
  });

  it('are recorded when chosen by name, in every zone', () => {
    const client = new Client().login().run('slash("channel trade on")');
    client.run(inChannel('trade here', 'Trade - City'));
    client.run(inChannel('trade there', 'Trade - English 38'));
    client.run(inChannel('services', 'Trade (Services) - City'));
    client.run(inChannel('general', 'General - Elwynn Forest'));
    client.run(inChannel('by number', '', '5. Trade - City'));
    client.run(inChannel('my channel', '', '6. MyRP'));
    expect(said(client)).toEqual(['trade here', 'trade there', 'by number']);
    expect(messages(client)[0]!.ch).toBe('Trade - City');

    client.run('slash("channel MyRP on")').run(inChannel('my channel', '', '6. MyRP'));
    expect(said(client)).toContain('my channel');
    expect(settings(client).channelNames).toEqual({ trade: true, myrp: true });

    client.run('slash("channel Trade off")').run(inChannel('not now', 'Trade - City'));
    expect(said(client)).not.toContain('not now');
    expect(settings(client).channelNames).toEqual({ myrp: true });
  });

  it('are all recorded with all channels on, whatever was chosen', () => {
    const client = new Client().login().run('slash("record channels on")');
    client.run(inChannel('general', 'General - Elwynn Forest'));
    expect(said(client)).toEqual(['general']);
  });

  it('record nothing by a hidden name, and that is no failure', () => {
    const client = new Client().login().run('slash("channel trade on")');
    client.run('chat("CHANNEL", { text = "hidden", sender = "Borin Fixture", base = newSecret(), channel = newSecret() })');
    expect(messages(client)).toEqual([]);
    expect(client.get('NS.failures.count')).toBe(0);
  });

  it.each(['channel trade', 'channel trade maybe', 'channel on', 'channel  3.  on'])('refuse %j', (command) => {
    const client = new Client().login().run(`slash(${q(command)})`);
    expect(client.printed()).toContain('use /storylog channel <name> on / off');
    expect(settings(client).channelNames).toEqual([]);
  });

  it('are listed by /storylog channel, chosen and joined', () => {
    const client = new Client().login().run(CHANNELS).run('slash("channel MyRP on"); W.printed = {}; slash("channel")');
    const printed = client.printed();
    expect(printed).toContain('only those chosen are recorded');
    expect(printed).toContain('Chosen: myrp');
    expect(printed).toContain('You are in: General, Trade');
  });

  it('are read from a client that gives a number and a name for each, and nothing more', () => {
    const client = new Client().login().run('GetChannelList = function() return 1, "General", 2, "Trade - City" end');
    expect(client.get('NS.joinedChannels()')).toEqual([
      { key: 'general', name: 'General' },
      { key: 'trade', name: 'Trade' },
    ]);
  });

  it('are left out of the list when the game hides their names', () => {
    const client = new Client().login().run(`${CHANNELS}; W.allSecret = true`);
    expect(client.get('NS.joinedChannels()')).toEqual([]);
    expect(client.get('NS.failures.count')).toBe(0);
  });

  it('are listed without a list from the game', () => {
    const client = new Client().login().run('GetChannelList = nil; slash("channel")');
    expect(client.printed()).toContain('You are in: none');
  });

  it('keep only well-formed choices from the saved file', () => {
    const saved = 'StoryLogDB = { version = 1, settings = { channelNames = { general = true, [5] = true, bad = "yes", trade = false } } }';
    expect(settings(new Client({ saved }).login()).channelNames).toEqual({ general: true });
    const wrong = 'StoryLogDB = { version = 1, settings = { channelNames = "trade" } }';
    expect(settings(new Client({ saved: wrong }).login()).channelNames).toEqual([]);
  });

  it('are shown in the status', () => {
    const client = new Client().login().run('slash("channel trade on"); W.printed = {}; slash("status")');
    expect(client.printed()).toContain('Channels chosen by name: trade');
  });
});

describe('what /storylog prints', () => {
  // The game reads a pipe and the letter after it as a code: "|r" vanishes, "|n" breaks the line.
  it('has no pipe that the game would read as a code', () => {
    const client = new Client().login().run(CHANNELS);
    for (const command of ['help', 'record nothing on', 'status', 'channel', 'channel Trade on', 'archive', 'icon', 'limit']) {
      client.run(`slash(${q(command)})`);
    }
    const printed = client.printed();
    expect(printed).toContain('recording');
    // The colours that the addon means, then pipes that are doubled to show as one.
    const plain = printed.replace(/\|c[0-9a-f]{8}(.*?)\|r/gi, '$1').replaceAll('||', '');
    expect(plain).not.toContain('|');
  });

  it('lists the categories with a pipe between them', () => {
    const client = new Client().login().run('slash("help"); slash("record nothing on")');
    const list = `<${client.get<string[]>('NS.CATEGORIES').join('|')}> on / off`;
    const shown = client.printed().replaceAll('||', '|');
    expect(shown).toContain(`/storylog record ${list}`);
    expect(shown).toContain(`use /storylog record ${list}`);
  });
});

describe('the window', () => {
  const open = (pre = '') => new Client({ pre }).login().run(CHANNELS).run('slash("")');
  const box = (client: Client, label: string) => client.checkboxes().find((check) => check.label === label);

  it('opens and closes with /storylog, and closes with Escape', () => {
    const client = open();
    expect(client.get('StoryLogOptions:IsShown()')).toBe(true);
    expect(client.get('UISpecialFrames')).toEqual(['StoryLogOptions']);
    expect(client.printed()).toBe('');
    client.run('slash("")');
    expect(client.get('StoryLogOptions:IsShown()')).toBe(false);
    expect(client.checkboxes()).toEqual([]);
    client.run('slash("options")');
    expect(client.get('StoryLogOptions:IsShown()')).toBe(true);
  });

  it('has a checkbox for every switch and joined channel, ticked as they are set', () => {
    const boxes = open().checkboxes();
    expect(boxes.map((check) => check.label)).toEqual([
      'Recording',
      'Icon at the minimap',
      'Say, yell and emotes',
      'Party, raid and instance',
      'Whispers',
      'NPCs and bosses speaking',
      'Dice rolls',
      'Guild and officers',
      'System, loot and money',
      'Who is in the group',
      'Quests',
      'Trades, loot and letters',
      'Zones, flights, summons',
      'Fights, deaths, duels',
      'NPC windows and books',
      'Spells, mounts, clothes',
      'Total RP 3 profiles',
      'All channels',
      'General',
      'Trade',
    ]);
    const client = new Client();
    // Recording and the icon, the categories, and two channels.
    expect(boxes).toHaveLength(2 + client.get<string[]>('NS.CATEGORIES').length + 2);
    const off = boxes.filter((check) => !check.checked).map((check) => check.label);
    expect(off).toEqual(['System, loot and money', 'All channels', 'General', 'Trade']);
  });

  it('changes what is recorded when a box is clicked', () => {
    const client = open().click('Whispers');
    expect(settings(client).whispers).toBe(false);
    client.run(chat('WHISPER', 'private')).run(chat('SAY', 'public'));
    expect(said(client)).toEqual(['public']);

    client.click('Trade').run(inChannel('trade', 'Trade - City'));
    expect(said(client)).toEqual(['public', 'trade']);
    expect(box(client, 'Trade')!.checked).toBe(true);

    client.click('Recording').run(chat('SAY', 'not now'));
    expect(settings(client).recording).toBe(false);
    expect(said(client)).toEqual(['public', 'trade']);
  });

  it('follows the text commands while it is open', () => {
    const client = open().run('slash("record guild off")');
    expect(box(client, 'Guild and officers')!.checked).toBe(false);

    client.run('slash("channel MyRP on")');
    expect(box(client, 'myrp (not joined)')).toEqual({ label: 'myrp (not joined)', checked: true, enabled: true });

    client.run('slash("record channels on")');
    expect(box(client, 'General')).toEqual({ label: 'General', checked: true, enabled: false });
    client.run('slash("record channels off"); slash("channel MyRP off")');
    expect(box(client, 'myrp (not joined)')).toBeUndefined();
    expect(box(client, 'General')).toEqual({ label: 'General', checked: false, enabled: true });

    client.run('slash("off")');
    expect(box(client, 'Recording')!.checked).toBe(false);
  });

  it('says how large the log is, and how full the archive files are', () => {
    const client = open().run(chat('SAY', 'hello')).run('slash("limit 5")');
    const shown = client.texts().join('\n');
    expect(shown).toContain('Main log: about 0.0 MB, 1 lines. Older sessions move to an archive file past 5 MB.');
    expect(shown).toContain('Archive files: empty, with room for about 96 MB.');
  });

  it('warns when the log holds nearly as much as the game can load', () => {
    const client = new Client().login().run('NS.LOG_CONSTANTS = 1').run(chat('SAY', 'hello')).run('slash("")');
    expect(client.texts().join('\n')).toContain('The log is close to the most that the game can load.');
  });

  it('shows twelve channels at most, and says how many more there are', () => {
    const client = new Client().login();
    client.run('W.channels = {}; for i = 1, 15 do W.channels[i] = { i, "Chan" .. i } end; slash("")');
    const channels = client.checkboxes().filter((check) => check.label.startsWith('Chan'));
    expect(channels.map((check) => check.label)).toEqual(Array.from({ length: 12 }, (_, index) => `Chan${index + 1}`));
    expect(client.texts()).toContain('and 3 more, which /storylog channel lists');
  });

  it('says when the player is in no channels', () => {
    const client = new Client().login().run('slash("")');
    expect(client.texts()).toContain('You are in no channels.');
  });

  it('adds only its own name to the globals', () => {
    const client = open();
    expect(client.get('addedGlobals()')).toEqual(['SLASH_STORYLOG1', 'StoryLogDB', 'StoryLogOptions']);
  });

  it('makes do without the parts that only some clients have', () => {
    const client = open(
      'NO_TEMPLATE = { UICheckButtonTemplate = true, UIPanelCloseButton = true }; ' +
        'NO_METHOD = { SetColorTexture = true, SetClampedToScreen = true, SetToplevel = true, SetHitRectInsets = true, GetStringHeight = true, RegisterForDrag = true }',
    );
    expect(client.get('StoryLogOptions:IsShown()')).toBe(true);
    expect(client.checkboxes()).toHaveLength(20);
    client.click('Dice rolls');
    expect(settings(client).rolls).toBe(false);
  });

  it("prints the status instead on a client that can't show it, and recording goes on", () => {
    const client = new Client({ pre: 'NO_METHOD = { CreateFontString = true }' }).login().run('slash("")');
    const printed = client.printed();
    expect(printed).toContain("the window can't open on this client");
    expect(printed).toContain('Lines: 0 this session');
    expect(client.get('NS.failures.count')).toBe(0);
    expect(client.get('StoryLogOptions:IsShown()')).toBe(false);

    client.run(chat('SAY', 'still here')).run('W.printed = {}; slash("")');
    expect(said(client)).toEqual(['still here']);
    expect(client.printed()).toContain("the window can't open on this client");
    expect(client.printed()).toContain('The window had a problem on this client');
  });

  it('keeps a failed click to itself', () => {
    const client = open().run('NS.setCategory = function() error("no switch today") end');
    expect(() => client.click('Whispers')).not.toThrow();
    expect(client.get('NS.failures.count')).toBe(0);
    expect(client.get<string>('NS.optionsProblem')).toContain('no switch today');
    client.run('W.printed = {}; slash("status")');
    expect(client.printed()).toContain('The window had a problem on this client');
  });
});
