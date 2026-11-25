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
