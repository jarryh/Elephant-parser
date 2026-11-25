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
import { groupName } from './groups';
import { hash } from './hash';
import { isTable, parseLua, type LuaTable, type LuaValue } from './lua';
import { stripMarkup } from './markup';
import type { Entry, Group, LogDocument, LogInfo, LogItem, Place, Speaker } from './types';

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
  const groupAt = new Map<string, number>();
  const lineAt = lineLookup(source);
  let gameVersion: number | undefined;

  listTables(child(db, 'sessions')).forEach(({ value: session }, list) => {
    const owner = stringField(session, 'character') ?? 'Unknown character';
    const realm = stringField(session, 'realm');
    const ownGuid = stringField(session, 'guid');
    const sessionId = stringField(session, 'id') ?? `${owner}-${stringField(session, 'started') ?? ''}`;
    gameVersion = numberField(session, 'interface') ?? gameVersion;

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
      const key = `${raid}:${members.join()}`;
      let index = groupAt.get(key);
      if (index === undefined) {
        index = groups.push(raid ? { members, raid } : { members }) - 1;
        groupAt.set(key, index);
      }
      return index;
    };
    // A session starts in no group, or says at once which one. So nothing carries over.
    let group: number | undefined;

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

      const target = speakerAt.get(numberField(message, 'to') ?? 0);
      const targetName = target && (speakers[target.index]!.rp ?? speakers[target.index]!.name);

      let raw = fillSender(type, body, who?.name);
      if (type === 'NOTE') raw = `Note: ${body}`;
      if (type === 'GROUP') {
        group = readGroup(message);
        raw = group === undefined ? 'Left the group' : groupName(groups[group], speakers);
      }
      if (QUESTS.has(type)) raw = questText(type, quest, body, targetName);
      if (type === 'HIDDEN') {
        const count = numberField(message, 'n') ?? 1;
        raw = `${count} ${count === 1 ? 'message' : 'messages'} hidden by the game`;
      }

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

      const color = classColor(who?.class);
      if (color) item.color = color;
      const flag = stringField(message, 'flag');
      if (flag) item.flag = flag;
      if (channelName) item.channelName = channelName;

      const place = placeAt.get(numberField(message, 'p') ?? 0);
      if (place !== undefined) item.place = place;
      const speakerPlace = placeAt.get(numberField(message, 'sp') ?? 0);
      if (speakerPlace !== undefined) item.speakerPlace = speakerPlace;
      if (speaker) item.speaker = speaker.index;
      if (speaker?.self) item.self = true;
      if (who?.rp) item.rpName = who.rp;
      const language = stringField(message, 'lang');
      if (language) item.language = language;
      if (targetName) item.target = targetName;
      if (group !== undefined) item.group = group;
      if (quest !== undefined) item.quest = quest;

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
function cleanName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return stripMarkup(value).replace(/\s+/g, ' ').trim().slice(0, NAME_LIMIT) || undefined;
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

function readSpeaker(table: LuaTable, name: string): Speaker {
  const speaker: Speaker = { name: cleanName(name) ?? 'Unknown' };
  const rp = cleanName(stringField(table, 'rp'));
  if (rp) speaker.rp = rp;
  const race = cleanName(stringField(table, 'race'));
  if (race) speaker.race = race;
  const classToken = stringField(table, 'class');
  if (classToken) speaker.class = classToken;
  if (booleanField(table, 'npc')) {
    speaker.npc = true;
    const id = numberField(table, 'id');
    if (id !== undefined && Number.isSafeInteger(id) && id > 0) speaker.npcId = id;
  }
  return speaker;
}
