/** The JSON shapes exchanged between the browser and the local server. */
import type { StoryOptions } from './story';
import type { LogDocument } from './types';

export interface DataFile {
  name: string;
  size: number;
  /** Unix milliseconds. */
  modified: number;
}

export interface LoadedFile {
  file: DataFile;
  document: LogDocument;
}

/** The largest log that the browser will send. As JSON it stays under the server's limit. */
export const MAX_LOG_BYTES = 50 * 1024 * 1024;

/** What became of a file that was dropped on the app. */
export interface AddedFile {
  /** Its name in Data/, which is the spelling of the file it replaced, if any. */
  name: string;
  /** The dated name under which the file it replaced is kept. */
  kept: string | null;
  /**
   * It took the place of a file of that name. With `kept` null, the new file held every
   * line of the older one, so no copy was needed.
   */
  replaced: boolean;
  /** Data/ already held exactly this file, so nothing was written. */
  unchanged: boolean;
}

/** `story` is null without an API key in .env. The key itself is never sent. */
export interface AppConfig {
  story: { model: string } | null;
}

export interface StoryRequest {
  transcript: string;
  options: StoryOptions;
}

export interface StoryResult {
  text: string;
  /** Null if it couldn't be saved. */
  savedTo: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  truncated: boolean;
  /** Another model took over after a refusal. */
  fellBack: boolean;
}

/** One line of the streamed response. */
export type StoryEvent =
  | { type: 'text'; text: string }
  | ({ type: 'done' } & StoryResult)
  | { type: 'error'; message: string };
