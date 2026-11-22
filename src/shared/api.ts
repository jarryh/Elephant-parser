/** The JSON shapes exchanged between the browser and the local server. */
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
