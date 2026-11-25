import { MAX_LOG_BYTES } from '../shared/api';
import { api } from './api';

export interface Added {
  /** The last file that was saved, which is the one to show. */
  opened: string | null;
  notes: string[];
  problems: string[];
}

export const NOTHING_ADDED: Added = { opened: null, notes: [], problems: [] };

/** Saves dropped or chosen logs to Data/, one after another. Never throws. */
export async function addFiles(files: File[]): Promise<Added> {
  const added: Added = { opened: null, notes: [], problems: [] };

  for (const file of files) {
    const { name } = file;
    const problem = refusal(file);
    if (problem) {
      added.problems.push(problem);
      continue;
    }

    try {
      const content = decode(await readBytes(file));
      if (content === null) {
        added.problems.push(`${name} is not UTF-8 text, so it is not a log that WoW saved.`);
        continue;
      }
      const saved = await api.addFile(name, content);
      added.opened = saved.name;
      if (saved.unchanged) added.notes.push(`${saved.name} is already in Data, with the same content.`);
      else if (saved.kept) added.notes.push(`Replaced ${saved.name}. The older file is kept as ${saved.kept}.`);
      else added.notes.push(`Added ${saved.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      added.problems.push(message.includes(name) ? message : `${name}: ${message}`);
    }
  }
  return added;
}

function refusal({ name, size }: File): string | null {
  if (/\.lua\.bak$/i.test(name)) return `${name} is WoW's backup copy. To open it, rename it so that it ends in .lua.`;
  if (!/\.lua$/i.test(name)) return `${name} is not a .lua file.`;
  if (size > MAX_LOG_BYTES) {
    return `${name} is larger than ${MAX_LOG_BYTES / 1024 / 1024} MB. Copy it into the Data folder instead.`;
  }
  return null;
}

function readBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('the browser could not read it.'));
    reader.readAsArrayBuffer(file);
  });
}

/** Exactly the file's text, so that it is saved byte for byte. Null when it isn't UTF-8. */
function decode(bytes: ArrayBuffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}
