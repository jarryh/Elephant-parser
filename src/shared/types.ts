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

export interface Speaker {
  name: string;
  rp?: string;
  race?: string;
  /** The class token, such as `PALADIN`. */
  class?: string;
  npc?: boolean;
  npcId?: number;
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
  /** The recorder said it, so `place` is the speaker's place too. */
  self?: boolean;
  /** An index into `LogDocument.speakers`. */
  speaker?: number;
  rpName?: string;
  /** When it isn't the recorder's usual language. */
  language?: string;
  /** Whom the recorder had targeted while saying it. */
  target?: string;
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
}
