/**
 * `message`: something that was logged with a timestamp.
 * `marker`: a timeless note from the addon ("Logging started ...").
 * `spacer`: a blank line the addon writes between sessions.
 */
export type ItemKind = 'message' | 'marker' | 'spacer';

/** One physical log table in the file. */
export interface LogInfo {
  /** A character, or a faction-realm when logs are shared between characters. */
  owner: string;
  /** The same for a channel across all owners: `#4` for Say, `general` for General. */
  channel: string;
  label: string;
  hasMessage: boolean;
  /** Offsets of the `hasMessage` value, when the file has one. */
  hasMessageSpan?: [start: number, end: number];
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

/** One logical item, de-duplicated across the logs that contain it. */
export interface LogItem {
  id: string;
  kind: ItemKind;
  owner: string;
  channels: string[];
  /** Unix seconds. Null for markers and spacers. */
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
}

export interface LogDocument {
  source: string;
  logs: LogInfo[];
  /** In source order. */
  entries: Entry[];
  /** In timeline order. */
  items: LogItem[];
}
