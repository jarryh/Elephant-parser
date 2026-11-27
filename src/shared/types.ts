/**
 * `message`: something that was logged with a timestamp.
 * `marker`: a note from the addon ("Logging started ...", a scene note, hidden messages).
 * `spacer`: a blank line the addon writes between sessions.
 */
export type ItemKind = 'message' | 'marker' | 'spacer';

/** One log in the file: a table in Elephant's, a channel within a session in StoryLog's. */
export interface LogInfo {
  /** A character, or a faction-realm when logs are shared between characters. */
  owner: string;
  /** The same for a channel across all owners: `#4` for Say, `general` for General. */
  channel: string;
  label: string;
  hasMessage: boolean;
  /** Offsets of the `hasMessage` value, when the file has one. */
  hasMessageSpan?: [start: number, end: number];
  /** For logs that share one Lua list, as a StoryLog session's channels do: which list. */
  list?: number;
}

/** One physical entry in a log. The same item can have entries in several logs. */
export interface Entry {
  id: string;
  /** Index into `LogDocument.logs`. */
  log: number;
  start: number;
  end: number;
  /** Where the table begins, if the entry is written as `[n] = {...}`. */
  valueStart?: number;
  startLine: number;
  endLine: number;
}

/** Where someone was. Only StoryLog records it. */
export interface Place {
  /** The game's map ID. */
  map?: number;
  zone?: string;
  sub?: string;
  /** The name under the minimap, when it says more. */
  mini?: string;
  /** The dungeon, raid or battleground. */
  inst?: string;
  indoors?: boolean;
  neighborhood?: string;
  house?: string;
  room?: string;
  /** On the map, from 0 to 1. */
  x?: number;
  y?: number;
  /** In yards within `cont`, for distances: north-south and east-west. */
  wx?: number;
  wy?: number;
  cont?: number;
}

/** The others in the recorder's party or raid. Only StoryLog records it. */
export interface Group {
  /** Indexes into `LogDocument.speakers`. */
  members: number[];
  raid?: boolean;
  /** Who leads it, a member or the recorder: an index into `LogDocument.speakers`. */
  leader?: number;
}

/** What a player's Total RP 3 profile says about their character, and their guild. */
export interface Details {
  title?: string;
  race?: string;
  class?: string;
  pronouns?: string;
  age?: string;
  eyes?: string;
  height?: string;
  build?: string;
  /** What they are doing right now. */
  currently?: string;
  /** "At first glance" notes. */
  glance?: string;
  /** The physical description. */
  look?: string;
  guild?: string;
}

export interface Speaker {
  name: string;
  rp?: string;
  race?: string;
  /** The class token, such as `PALADIN`. */
  class?: string;
  sex?: 'male' | 'female';
  npc?: boolean;
  npcId?: number;
  details?: Details;
}

/** One login of one character. Only StoryLog records it. */
export interface Session {
  /** Unix seconds. */
  started: number;
  /** The game world's time at `started`, in minutes after midnight. */
  clock?: number;
  /** The game's festivals on that day. */
  holidays?: string[];
}

/** One logical item, de-duplicated across the logs that contain it. */
export interface LogItem {
  id: string;
  kind: ItemKind;
  owner: string;
  channels: string[];
  /** Unix seconds. Null for Elephant's markers and spacers. */
  time: number | null;
  /** Position on the timeline: `time`, or that of a neighbour for timeless items. */
  at: number;
  type: string;
  /** Text with WoW escape codes intact. */
  raw: string;
  /** Text as a reader would see it. */
  text: string;
  sender: string | null;
  color?: string;
  flag?: string;
  channelName?: string;

  // The rest comes only from StoryLog files.
  /** The recorder's place: an index into `LogDocument.places`. */
  place?: number;
  /** The speaker's own place, which is known for group members. */
  speakerPlace?: number;
  /** The recorder said it, or it happened to them, so `place` is the speaker's place too. */
  self?: boolean;
  /**
   * An index into `LogDocument.speakers`. For something that happened it can be another
   * than the sender: who invited the recorder, who won the duel.
   */
  speaker?: number;
  rpName?: string;
  /** When it isn't the recorder's usual language. */
  language?: string;
  /**
   * Whom the speaker had targeted while saying it. For a quest, its NPC; for something
   * that happened, the other one in it.
   */
  target?: string;
  /** The same one, as an index into `LogDocument.speakers`. */
  targetSpeaker?: number;
  /** The group that the recorder was in at the time: an index into `LogDocument.groups`. */
  group?: number;
  /** The game's ID of the quest that the line is about. */
  quest?: number;
  /** Longer text that belongs to the line: a letter, a book page, a quest's description. */
  detail?: string;
  /** Total RP 3 said that the speaker was out of character. */
  ooc?: boolean;
  /** Index into `LogDocument.sessions`. */
  session?: number;
}

export interface LogDocument {
  source: string;
  logs: LogInfo[];
  /** In source order. */
  entries: Entry[];
  /** In timeline order. */
  items: LogItem[];

  // The rest is left out for Elephant files.
  format?: 'storylog';
  /** The game's interface number, such as 16001. */
  gameVersion?: number;
  places?: Place[];
  speakers?: Speaker[];
  groups?: Group[];
  sessions?: Session[];
}
