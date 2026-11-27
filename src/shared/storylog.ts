/** Reads the file that our own addon saves: see addon/StoryLog. */
import { classColor } from './classes';
import {
  booleanField,
  child,
  DEFAULT_LOG_NAMES,
  fillSender,
  lineLookup,
  listTables,
  NotLogFileError,
  numberField,
  stringField,
} from './document';
import { EVENTS } from './events';
import { groupChange, listNames } from './groups';
import { hash } from './hash';
import { isTable, parseLua, type LuaTable, type LuaValue } from './lua';
import { stripMarkup } from './markup';
import { placeName } from './places';
import type { Details, Entry, Group, LogDocument, LogInfo, LogItem, Place, Session, Speaker } from './types';

const VERSION = 1;

/** The Elephant log each type goes to, so that filters and the privacy rules work alike. */
const LOG_OF = new Map<string, number>(
  Object.entries({
    1: ['WHISPER', 'WHISPER_INFORM', 'BN_WHISPER', 'BN_WHISPER_INFORM', 'MONSTER_WHISPER', 'AFK', 'DND'],
    2: ['RAID', 'RAID_LEADER', 'RAID_WARNING', 'RAID_BOSS_EMOTE', 'RAID_BOSS_WHISPER'],
    3: ['PARTY', 'PARTY_LEADER', 'MONSTER_PARTY'],
    4: ['SAY', 'EMOTE', 'TEXT_EMOTE', 'MONSTER_SAY', 'MONSTER_EMOTE', 'ROLL'],
    5: ['YELL', 'MONSTER_YELL'],
    6: ['OFFICER'],
    7: ['GUILD', 'GUILD_DISCORD'],
    8: ['LOOT', 'MONEY', 'CURRENCY'],
    10: ['ACHIEVEMENT', 'GUILD_ACHIEVEMENT'],
    11: ['INSTANCE_CHAT', 'INSTANCE_CHAT_LEADER', 'BG_SYSTEM_ALLIANCE', 'BG_SYSTEM_HORDE', 'BG_SYSTEM_NEUTRAL'],
  }).flatMap(([log, types]) => types.map((type) => [type, Number(log)] as const)),
);
const SYSTEM_LOG = 9;

/** Lines that the addon writes about what happened, in no channel. */
const MARKERS = new Set(['NOTE', 'HIDDEN', 'GROUP']);
const QUESTS = new Set(['QUEST_ACCEPTED', 'QUEST_TURNED_IN']);
/** Elephant has no log for quests, so this one has a name and no number. */
const QUEST_LOG = { channel: 'quests', label: 'Quests' };

/** These channels are one log in every zone. Elephant keys the others by their full name. */
const ONE_LOG_CHANNELS = new Set([
  'general',
  'trade',
  'trade (services)',
  'localdefense',
  'lookingforgroup',
  'worlddefense',
  'guildrecruitment',
]);

const NAME_LIMIT = 120;
/** For what a player wrote in their profile, which can be long. */
const PROFILE_LIMIT = 800;
/** For letters, books and what NPCs say. */
const TEXT_LIMIT = 4000;
/**
 * A group line this soon after login was saved at login, so the recorder was already in
 * that group. For logs from before the addon said so itself.
 */
const LOGIN_SECONDS = 2;

export function parseStoryLog(
  source: string,
  globals: Map<string, LuaValue> = parseLua(source),
  variable = 'StoryLogDB',
): LogDocument {
  const db = globals.get(variable);
  if (!isTable(db)) throw new NotLogFileError();
  if ((numberField(db, 'version') ?? VERSION) > VERSION) throw new NewerStoryLogError();

  const logs: LogInfo[] = [];
  const entries: Entry[] = [];
  const items = new Map<string, LogItem>();
  const places: Place[] = [];
  const speakers: Speaker[] = [];
  const groups: Group[] = [];
  const sessions: Session[] = [];
  const groupAt = new Map<string, number>();
  const lineAt = lineLookup(source);
  let gameVersion: number | undefined;

  listTables(child(db, 'sessions')).forEach(({ value: session }, list) => {
    const owner = stringField(session, 'character') ?? 'Unknown character';
    const realm = stringField(session, 'realm');
    const ownGuid = stringField(session, 'guid');
    const sessionId = stringField(session, 'id') ?? `${owner}-${stringField(session, 'started') ?? ''}`;
    gameVersion = numberField(session, 'interface') ?? gameVersion;

    const started = numberField(session, 'started');
    const sessionIndex = started === undefined ? undefined : sessions.push(readSession(session, started)) - 1;

    /** On your own realm, names are shown without it, as Elephant saves them. */
    const shown = (name: string) =>
      realm && name.endsWith(`-${realm}`) ? name.slice(0, -realm.length - 1) : name;

    const placeAt = new Map<number, number>();
    for (const { key, value } of listTables(child(session, 'places'))) {
      placeAt.set(Number(key), places.push(readPlace(value)) - 1);
    }

    const speakerAt = new Map<number, { index: number; name: string; self: boolean }>();
    for (const { key, value } of listTables(child(session, 'speakers'))) {
      const name = stringField(value, 'name');
      if (!name) continue;
      const speaker = readSpeaker(value, shown(name));
      const guid = stringField(value, 'guid');
      const self = !speaker.npc && (name === owner || (guid !== undefined && guid === ownGuid));
      speakerAt.set(Number(key), { index: speakers.push(speaker) - 1, name, self });
    }
    const selves = [...speakerAt.values()].filter((who) => who.self).map((who) => speakers[who.index]!);
    const ownSex = selves.find((who) => who.sex)?.sex;
    /** The recorder as last known in this session, for the lines that are theirs without saying so. */
    const recorder = selves.at(-1);

    const logAt = new Map<string, number>();
    const logFor = (channel: string, label: string) => {
      let index = logAt.get(channel);
      if (index === undefined) {
        index = logs.push({ owner, channel, label, hasMessage: false, list }) - 1;
        logAt.set(channel, index);
      }
      return index;
    };

    const occurrences = new Map<string, number>();

    /** The group that a GROUP line names: its index, or undefined for none. */
    const readGroup = (message: LuaTable): number | undefined => {
      const list = [...(child(message, 'g')?.fields ?? [])].sort((a, b) => Number(a.key) - Number(b.key));
      const members = list.flatMap((entry) => speakerAt.get(typeof entry.value === 'number' ? entry.value : 0)?.index ?? []);
      if (!members.length) return undefined;

      const raid = booleanField(message, 'raid') === true;
      const leader = speakerAt.get(numberField(message, 'lead') ?? 0)?.index;
      const key = `${raid}:${members.join()}:${leader ?? ''}`;
      let index = groupAt.get(key);
      if (index === undefined) {
        const group: Group = raid ? { members, raid } : { members };
        if (leader !== undefined) group.leader = leader;
        index = groups.push(group) - 1;
        groupAt.set(key, index);
      }
      return index;
    };
    // A session starts in no group, or says at once which one. So nothing carries over.
    let group: number | undefined;

    /** What the reader needs to write an event's text. */
    const context: Context = {
      person: (message, key) => {
        const found = speakerAt.get(numberField(message, key) ?? 0);
        const who = found && speakers[found.index]!;
        return who && escapeName(who.rp ?? who.name);
      },
      place: (message, key) => {
        const index = placeAt.get(numberField(message, key) ?? 0);
        return index === undefined ? '' : escapeName(placeName(places[index]));
      },
      owner,
      sex: ownSex,
    };

    for (const field of listTables(child(session, 'messages'))) {
      const message: LuaTable = field.value;
      const type = stringField(message, 'e') ?? '';
      const time = numberField(message, 't') ?? null;
      const body = stringField(message, 'm') ?? '';
      const channelName = stringField(message, 'ch');
      const speaker = speakerAt.get(numberField(message, 's') ?? 0);
      const marker = time === null || MARKERS.has(type);
      const questId = QUESTS.has(type) ? numberField(message, 'q') : undefined;
      const quest = questId !== undefined && Number.isSafeInteger(questId) && questId > 0 ? questId : undefined;

      // Only what can't change later: not the indexes, and not the roleplay name.
      const base = JSON.stringify([
        'sl',
        sessionId,
        time,
        type,
        speaker?.name,
        body,
        channelName,
        ...(quest === undefined ? [] : [quest]),
      ]);
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      const id = hash(`${base}#${occurrence}`);

      const { channel, label } = channelOf(type, channelName);
      const entry: Entry = {
        id,
        log: logFor(channel, label),
        start: field.start,
        end: field.end,
        startLine: lineAt(field.start),
        endLine: lineAt(field.end - 1),
      };
      if (field.explicitKey) entry.valueStart = field.valueStart;
      entries.push(entry);

      const who = speaker && speakers[speaker.index];
      let sender = who?.name ?? null;
      if (type === 'BN_WHISPER' || type === 'BN_WHISPER_INFORM') sender = 'Battle.net friend';
      // What happened is the recorder's line, whoever else it names: an invitation is drawn
      // where the recorder got it, not where its sender was. Only an NPC speaks its own.
      const event = EVENTS.get(type);
      const own = event !== undefined && !event.npc;
      if (own) sender = recorder?.name ?? cleanName(shown(owner)) ?? owner;

      const target = speakerAt.get(numberField(message, 'to') ?? 0);
      const targetName = target && (speakers[target.index]!.rp ?? speakers[target.index]!.name);

      let raw = fillSender(type, body, who?.name);
      let detail: string | undefined;
      if (type === 'NOTE') raw = `Note: ${body}`;
      if (type === 'GROUP') {
        const before = group === undefined ? undefined : groups[group];
        group = readGroup(message);
        const atStart =
          booleanField(message, 'start') === true ||
          (time !== null && started !== undefined && time - started <= LOGIN_SECONDS);
        raw = groupChange(before, group === undefined ? undefined : groups[group], speakers, {
          atStart,
          why: stringField(message, 'why'),
        });
      }
      if (QUESTS.has(type)) {
        raw = questText(type, quest, body, targetName);
        detail = questDetail(message, context);
      }
      if (type === 'HIDDEN') {
        const count = numberField(message, 'n') ?? 1;
        raw = `${count} ${count === 1 ? 'message' : 'messages'} hidden by the game`;
      }
      if (EVENTS.has(type)) ({ raw, detail } = eventText(type, message, context));

      const item: LogItem = {
        id,
        kind: marker ? 'marker' : 'message',
        owner,
        // A marker isn't "in" a channel, so channel actions leave it alone.
        channels: marker ? [] : [channel],
        time,
        at: time ?? numberField(session, 'started') ?? 0,
        type,
        raw,
        text: stripMarkup(raw),
        sender: marker ? null : sender,
      };

      const color = classColor((own ? recorder : who)?.class);
      if (color) item.color = color;
      const flag = stringField(message, 'flag');
      if (flag) item.flag = flag;
      if (channelName) item.channelName = channelName;

      const place = placeAt.get(numberField(message, 'p') ?? 0);
      if (place !== undefined) item.place = place;
      const speakerPlace = placeAt.get(numberField(message, 'sp') ?? 0);
      if (speakerPlace !== undefined) item.speakerPlace = speakerPlace;
      if (speaker) item.speaker = speaker.index;
      if (speaker?.self || own) item.self = true;
      const rpName = (own ? recorder : who)?.rp;
      if (rpName) item.rpName = rpName;
      const language = stringField(message, 'lang');
      if (language) item.language = language;
      if (targetName) item.target = targetName;
      if (target) item.targetSpeaker = target.index;
      if (group !== undefined) item.group = group;
      if (quest !== undefined) item.quest = quest;
      if (detail) item.detail = detail;
      if (booleanField(message, 'ooc') === true) item.ooc = true;
      if (sessionIndex !== undefined) item.session = sessionIndex;

      if (!items.has(id)) items.set(id, item);
    }
  });

  const document: LogDocument = {
    source,
    logs,
    entries: entries.sort((a, b) => a.start - b.start),
    // Array sort is stable, so messages within the same second keep their file order.
    items: [...items.values()].sort((a, b) => a.at - b.at),
    format: 'storylog',
    places,
    speakers,
    groups,
    sessions,
  };
  if (gameVersion !== undefined) document.gameVersion = gameVersion;
  return document;
}

export class NewerStoryLogError extends Error {
  constructor() {
    super('A newer StoryLog saved this file. Update this app to read it.');
    this.name = 'NewerStoryLogError';
  }
}

/** What an event's text needs from the session it is in. */
interface Context {
  /** The roleplay or character name of the speaker in a field, ready for `raw`. */
  person(message: LuaTable, key: string): string | undefined;
  /** The name of the place in a field, ready for `raw`. Empty if unknown. */
  place(message: LuaTable, key: string): string;
  owner: string;
  sex?: Speaker['sex'];
}

/** Text that the game writes in `raw` would take a `|` as the start of an escape code. */
function escapeName(name: string): string {
  return name.replaceAll('|', '||');
}

/** The line and its longer text, for the lines in `EVENTS`. */
function eventText(type: string, message: LuaTable, context: Context): { raw: string; detail?: string } {
  const field = (key: string) => stringField(message, key);
  const person = (key: string) => context.person(message, key);
  const count = numberField(message, 'n');
  const what = field('m');
  const kind = field('k');
  const someone = (name: string | undefined) => name ?? 'someone';
  const Someone = (name: string | undefined) => name ?? 'Someone';
  const lasting = count && count > 0 ? ` (${duration(count)})` : '';
  const many = count && count > 1 ? ` ×${count}` : '';
  const longText = (key: string) => {
    const text = field(key);
    return text === undefined ? undefined : plainText(gameText(text, context), TEXT_LIMIT);
  };
  /** What a player wrote, in which `$B` is nothing but a dollar and a B. */
  const letter = (key: string) => {
    const text = field(key);
    return text === undefined ? undefined : plainText(text, TEXT_LIMIT);
  };
  const shortText = (text: string | undefined) => text && escapeName(cleanName(text) ?? '');

  switch (type) {
    case 'INVITE':
      if (kind === 'in') return { raw: `${Someone(person('s'))} invited you to a group` };
      if (kind === 'declined') return { raw: `${Someone(person('s'))} declined your invitation` };
      return { raw: `Invited ${someone(person('to'))} to the group` };
    case 'TRADE': {
      const gave = [...things(message, 'a'), ...money(numberField(message, 'am'))];
      const got = [...things(message, 'b'), ...money(numberField(message, 'bm'))];
      const parts = [gave.length ? `gave ${gave.join(', ')}` : '', got.length ? `got ${got.join(', ')}` : ''];
      const done = parts.filter(Boolean).join('; ');
      return { raw: `Traded with ${someone(person('to'))}${done ? `: ${done}` : ''}` };
    }
    case 'ITEM': {
      const verb = kind === 'made' ? 'Made' : kind === 'got' ? 'Received' : 'Looted';
      return { raw: `${verb} ${what ?? 'something'}${many}` };
    }
    case 'MAIL': {
      const who = shortText(field('who')) || 'someone';
      const subject = shortText(what);
      const attached = [...things(message, 'a'), ...money(numberField(message, 'am'))];
      const head = kind === 'read' ? `Read a letter from ${who}` : `Sent a letter to ${who}`;
      const raw = `${head}${subject ? `: “${subject}”` : ''}${attached.length ? `, with ${attached.join(', ')}` : ''}`;
      return withDetail(raw, letter('text'));
    }
    case 'ZONE': {
      const here = context.place(message, 'p');
      return { raw: here ? `Now in ${here}` : 'Moved on' };
    }
    case 'TRAVEL': {
      if (kind === 'summon') {
        const area = shortText(what);
        return { raw: `Summoned by ${someone(person('s'))}${area ? ` to ${area}` : ''}` };
      }
      const from = context.place(message, 'from');
      const to = context.place(message, 'p');
      return { raw: `Flew${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}${lasting}` };
    }
    case 'FIGHT': {
      const foes = strings(message, 'foes').map((foe) => escapeName(cleanName(foe) ?? '')).filter(Boolean);
      return { raw: `${foes.length ? `Fought ${listNames(foes)}` : 'A fight'}${lasting}` };
    }
    case 'ENCOUNTER': {
      const boss = shortText(what) || 'a boss';
      const won = booleanField(message, 'won');
      const result = won === true ? `Defeated ${boss}` : won === false ? `Fought ${boss} and lost` : `Fought ${boss}`;
      return { raw: result + lasting };
    }
    case 'DEATH':
      return { raw: 'Died' };
    case 'REVIVED': {
      const by = person('s');
      return { raw: by ? `Revived by ${by}` : 'Came back to life' };
    }
    case 'DUEL': {
      const [winner, loser] = [person('s'), person('to')];
      if (kind === 'won') return { raw: `${Someone(winner)} defeated ${someone(loser)} in a duel` };
      if (kind === 'fled') return { raw: `${Someone(loser)} fled from a duel with ${someone(winner)}` };
      return { raw: `${Someone(winner)} challenged ${someone(loser)} to a duel` };
    }
    case 'LEVEL':
      return { raw: count ? `Reached level ${count}` : 'Gained a level' };
    case 'GOSSIP':
      return { raw: what === undefined ? '' : gameText(what, context) };
    case 'CHOICE': {
      const npc = person('to');
      return { raw: `${npc ? `Answered ${npc}` : 'Chose'}: “${shortText(what) ?? ''}”` };
    }
    case 'READ': {
      const title = shortText(what) || 'a text';
      return withDetail(`Read “${title}”${count && count > 1 ? `, page ${count}` : ''}`, longText('text'));
    }
    case 'CAST': {
      const mount = booleanField(message, 'mount') === true;
      const on = person('to');
      return { raw: `${mount ? 'Mounted' : 'Cast'} ${what ?? 'a spell'}${on && !mount ? ` on ${on}` : ''}${many}` };
    }
    case 'OUTFIT': {
      const on = things(message, 'on');
      const off = things(message, 'off');
      const parts = [on.length ? `put on ${on.join(', ')}` : '', off.length ? `took off ${off.join(', ')}` : ''];
      const done = parts.filter(Boolean).join('; ') || 'changed clothes';
      return { raw: done[0]!.toUpperCase() + done.slice(1) };
    }
    default:
      return { raw: what ?? '' };
  }
}

function withDetail(raw: string, detail: string | undefined): { raw: string; detail?: string } {
  return detail ? { raw, detail } : { raw };
}

/** What the quest giver said: the description and the goal, or what they said on handing it in. */
function questDetail(message: LuaTable, context: Context): string | undefined {
  const text = stringField(message, 'text');
  const goal = stringField(message, 'goal');
  const parts = [text && gameText(text, context), goal && `Objective: ${gameText(goal, context)}`];
  const joined = parts.filter(Boolean).join('\n\n');
  return joined ? plainText(joined, TEXT_LIMIT) : undefined;
}

/** "1 h 5 min", "3 min", "40 s". */
function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`;
}

/** "1g 20s 5c", as a list with one entry, or none for no money. */
function money(copper: number | undefined): string[] {
  if (!copper || copper <= 0 || !Number.isFinite(copper)) return [];
  const amount = Math.round(copper);
  const parts = [
    [Math.floor(amount / 10000), 'g'],
    [Math.floor(amount / 100) % 100, 's'],
    [amount % 100, 'c'],
  ].filter(([value]) => value) as [number, string][];
  return [parts.map(([value, unit]) => `${value}${unit}`).join(' ')];
}

/** A list of item links: plain strings, or `{ link =, count = }`. */
function things(message: LuaTable, key: string): string[] {
  return [...(child(message, key)?.fields ?? [])]
    .sort((a, b) => Number(a.key) - Number(b.key))
    .flatMap(({ value }) => {
      if (typeof value === 'string') return value ? [value] : [];
      if (!isTable(value)) return [];
      const link = stringField(value, 'link');
      const count = numberField(value, 'count');
      return link ? [count && count > 1 ? `${link} ×${count}` : link] : [];
    });
}

function strings(message: LuaTable, key: string): string[] {
  return [...(child(message, key)?.fields ?? [])]
    .sort((a, b) => Number(a.key) - Number(b.key))
    .flatMap(({ value }) => (typeof value === 'string' && value ? [value] : []));
}

/**
 * Text that the game shows in a window: `$B` is a line break, `$N` the reader's name, and
 * `$G he:she;` depends on the reader's sex. Some books are HTML documents, and only those
 * have tags: elsewhere `<He hands you a letter.>` is narration.
 */
function gameText(text: string, { owner, sex }: Pick<Context, 'owner' | 'sex'>): string {
  const body = /^\s*<html\b/i.test(text)
    ? text.replace(/<br\s*\/?>|<\/(?:p|h\d)>/gi, '\n').replace(/<\/?[a-z][^<>]*>/gi, '')
    : text;
  return body
    .replace(/\$[Bb]/g, '\n')
    .replace(/\$[Nn]/g, owner.split(' ')[0]!.split('-')[0]!)
    .replace(/\$[Gg]\s*([^:;]*):([^;]*);/g, (_, male: string, female: string) =>
      sex === 'female' ? female : sex === 'male' ? male : `${male}/${female}`,
    )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text of many lines, shortened. */
function plainText(text: string, limit: number): string {
  const plain = stripMarkup(text).trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain;
}

/**
 * A quest as the game would link it, which `parseMarkup` turns into a link to Wowhead.
 * The label in front of the line says whether it was accepted or completed.
 */
function questText(type: string, id: number | undefined, title: string, npc: string | undefined): string {
  // A stray "|" would start an escape code.
  const name = (cleanName(title) ?? (id === undefined ? 'A quest' : `Quest ${id}`)).replaceAll('|', '||');
  const link = id === undefined ? name : `|cffffd100|Hquest:${id}|h[${name}]|h|r`;
  if (!npc) return link;
  return `${link}, ${type === 'QUEST_ACCEPTED' ? 'from' : 'handed in to'} ${npc.replaceAll('|', '||')}`;
}

function channelOf(type: string, name: string | undefined): { channel: string; label: string } {
  if (QUESTS.has(type)) return QUEST_LOG;
  const event = EVENTS.get(type);
  if (event) return { channel: event.channel, label: event.log };
  if (type === 'CHANNEL' && name) {
    const base = name.split(' - ')[0]!;
    return ONE_LOG_CHANNELS.has(base.toLowerCase())
      ? { channel: base.toLowerCase(), label: base }
      : { channel: name.toLowerCase(), label: name };
  }
  const log = LOG_OF.get(type) ?? SYSTEM_LOG;
  return { channel: `#${log}`, label: DEFAULT_LOG_NAMES.get(log)! };
}

/** One line, without escape codes. Names come from other players and their addons. */
function cleanName(value: string | undefined, limit = NAME_LIMIT): string | undefined {
  if (value === undefined) return undefined;
  return stripMarkup(value).replace(/\s+/g, ' ').trim().slice(0, limit) || undefined;
}

/** What a player wrote in Total RP 3, which has tags of its own: `{col:ff0000}`, `{link*url*text}`. */
function profileText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value
    .replace(/\{link\*[^*{}]*\*([^{}]*)\}/g, '$1')
    // Where a heading or a paragraph begins or ends, a word ends too.
    .replace(/\{\/?(?:h\d|p)(?::[^{}]*)?\}/gi, ' ')
    .replace(/\{[^{}]*\}/g, '');
  return cleanName(text, PROFILE_LIMIT);
}

function readSession(table: LuaTable, started: number): Session {
  const session: Session = { started };
  const clock = numberField(table, 'clock');
  if (clock !== undefined && clock >= 0 && clock < 24 * 60) session.clock = clock;
  const holidays = strings(table, 'holidays').flatMap((name) => cleanName(name) ?? []);
  if (holidays.length) session.holidays = holidays;
  return session;
}

function readPlace(table: LuaTable): Place {
  const place: Place = {};
  for (const key of ['zone', 'sub', 'mini', 'inst', 'neighborhood', 'house', 'room'] as const) {
    const value = cleanName(stringField(table, key));
    if (value) place[key] = value;
  }
  for (const key of ['map', 'cont'] as const) {
    const value = numberField(table, key);
    if (value !== undefined) place[key] = value;
  }
  const indoors = booleanField(table, 'indoors');
  if (indoors !== undefined) place.indoors = indoors;

  const x = numberField(table, 'x');
  const y = numberField(table, 'y');
  if (x !== undefined && y !== undefined && x >= 0 && x <= 1 && y >= 0 && y <= 1) Object.assign(place, { x, y });
  const wx = numberField(table, 'wx');
  const wy = numberField(table, 'wy');
  if (wx !== undefined && wy !== undefined) Object.assign(place, { wx, wy });
  return place;
}

/** Saved key → the name in `Details`. */
const DETAILS: [key: string, name: keyof Details][] = [
  ['title', 'title'],
  ['rpRace', 'race'],
  ['rpClass', 'class'],
  ['pron', 'pronouns'],
  ['age', 'age'],
  ['eyes', 'eyes'],
  ['height', 'height'],
  ['build', 'build'],
  ['now', 'currently'],
  ['glance', 'glance'],
  ['look', 'look'],
  ['guild', 'guild'],
];

function readSpeaker(table: LuaTable, name: string): Speaker {
  const speaker: Speaker = { name: cleanName(name) ?? 'Unknown' };
  const rp = cleanName(stringField(table, 'rp'));
  if (rp) speaker.rp = rp;
  const race = cleanName(stringField(table, 'race'));
  if (race) speaker.race = race;
  const classToken = stringField(table, 'class');
  if (classToken) speaker.class = classToken;
  // The game's numbers: 1 is unknown.
  const sex = numberField(table, 'sex');
  if (sex === 2) speaker.sex = 'male';
  if (sex === 3) speaker.sex = 'female';
  if (booleanField(table, 'npc')) {
    speaker.npc = true;
    const id = numberField(table, 'id');
    if (id !== undefined && Number.isSafeInteger(id) && id > 0) speaker.npcId = id;
  }

  const details: Details = {};
  for (const [key, detail] of DETAILS) {
    const value = profileText(stringField(table, key));
    if (value) details[detail] = value;
  }
  if (Object.keys(details).length) speaker.details = details;
  return speaker;
}
