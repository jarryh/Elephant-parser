import { constants } from 'node:fs';
import { copyFile, readdir, readFile, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import type { AddedFile, DataFile, LoadedFile } from '../shared/api';
import { holdsAll } from '../shared/covers';
import { NotLogFileError } from '../shared/document';
import { LuaParseError } from '../shared/lua';
import { parseLog } from '../shared/parse';
import { NewerStoryLogError } from '../shared/storylog';
import type { LogDocument } from '../shared/types';
import { atomicWrite } from './atomicWrite';
import { HttpError } from './errors';

/** A plain file name: no folders, and nothing that Windows refuses. */
const LOG_NAME = /^[^\\/:*?"<>|\p{Cc}]+\.lua$/iu;
const DEVICE_NAME = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i;
const NAME_LIMIT = 120;
const COPIES_PER_DAY = 99;

/**
 * Access to Data/. A log is never edited. `add` is the only method that writes, and it
 * keeps a dated copy of the file it replaces, unless the new one holds every line of it.
 */
export class DataFiles {
  private readonly cache = new Map<string, LoadedFile>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string) {}

  async list(): Promise<DataFile[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const files: DataFile[] = [];
    for (const name of names.filter((entry) => /\.lua$/i.test(entry))) {
      const info = await stat(path.join(this.dir, name)).catch(() => null);
      if (info?.isFile()) files.push({ name, size: info.size, modified: info.mtimeMs });
    }
    return files.sort((a, b) => b.modified - a.modified);
  }

  /** Resolves a name from the browser. Only names from the listing are accepted. */
  async find(name: string): Promise<DataFile> {
    const file = (await this.list()).find((entry) => entry.name === name);
    if (!file) throw new HttpError(404, 'There is no such .lua file in Data/.');
    return file;
  }

  /** An optional map background that you put at Data/maps/<map id>.jpg. */
  async mapImage(id: string): Promise<Buffer> {
    if (!/^\d{1,7}$/.test(id)) throw new HttpError(404, 'There is no such map.');
    try {
      return await readFile(path.join(this.dir, 'maps', `${id}.jpg`));
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code === 'ENOENT' || code === 'EISDIR') throw new HttpError(404, `There is no Data/maps/${id}.jpg.`);
      throw error;
    }
  }

  async load(name: string): Promise<LoadedFile> {
    const file = await this.find(name);
    const cached = this.cache.get(name);
    if (cached && cached.file.modified === file.modified && cached.file.size === file.size) return cached;

    const source = await readFile(path.join(this.dir, name), 'utf8');
    try {
      const loaded = { file, document: parseLog(source) };
      this.cache.set(name, loaded);
      return loaded;
    } catch (error) {
      throw unreadable(name, error);
    }
  }

  /**
   * Saves a log that was dropped on the app. One at a time, so that two drops of the
   * same name can't both think they are first.
   */
  add(name: string, content: string): Promise<AddedFile> {
    const result = this.queue.then(() => this.save(name, content));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async save(name: string, content: string): Promise<AddedFile> {
    const plain = LOG_NAME.test(name) && name === name.trim() && !name.startsWith('.') && !DEVICE_NAME.test(name);
    if (!plain || name.length > NAME_LIMIT) {
      throw new HttpError(400, 'Only files with a plain name that ends in .lua can be added.');
    }

    const bytes = Buffer.from(content, 'utf8');
    if (bytes.toString('utf8') !== content) throw new HttpError(400, `${name} is not valid text.`);
    let document: LogDocument;
    try {
      document = parseLog(content);
    } catch (error) {
      throw unreadable(name, error);
    }

    // Windows has one file for every spelling of a name, so the file that is there keeps its own.
    const files = await this.list();
    const lower = name.toLowerCase();
    const old = files.find((file) => file.name === name) ?? files.find((file) => file.name.toLowerCase() === lower);
    const target = old?.name ?? name;
    const file = path.join(this.dir, target);

    let kept: string | null = null;
    if (old) {
      if ((await readFile(file)).equals(bytes)) return { name: target, kept, replaced: false, unchanged: true };
      if (!(await this.covers(document, old))) kept = await this.keep(old);
    }
    await atomicWrite(file, content);
    // What was read of the older file to compare them is of no more use.
    this.cache.delete(target);
    return { name: target, kept, replaced: old !== undefined, unchanged: false };
  }

  /**
   * True when the new document holds every line of the file it replaces, so a copy would
   * only take space. A file that can't be read is kept, in case it holds something.
   */
  private async covers(next: LogDocument, old: DataFile): Promise<boolean> {
    if (next.format !== 'storylog') return false;
    try {
      return holdsAll(next, (await this.load(old.name)).document);
    } catch {
      return false;
    }
  }

  /**
   * Copies a file to a name with its date, and returns that name. An older Elephant file
   * can hold lines that a newer one has dropped, so it is never overwritten.
   */
  private async keep(old: DataFile): Promise<string> {
    const when = new Date(old.modified);
    const day = [when.getFullYear(), when.getMonth() + 1, when.getDate()]
      .map((part) => String(part).padStart(2, '0'))
      .join('-');

    for (let copy = 1; copy <= COPIES_PER_DAY; copy++) {
      const name = `${old.name.slice(0, -'.lua'.length)}-${day}${copy > 1 ? `-${copy}` : ''}.lua`;
      const to = path.join(this.dir, name);
      try {
        await copyFile(path.join(this.dir, old.name), to, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
      await utimes(to, when, when);
      return name;
    }
    throw new HttpError(409, `Data/ already holds ${COPIES_PER_DAY} copies of ${old.name} from ${day}. Move some away first.`);
  }
}

function unreadable(name: string, error: unknown): unknown {
  if (error instanceof LuaParseError || error instanceof NotLogFileError || error instanceof NewerStoryLogError) {
    return new HttpError(422, `Could not read ${name}. ${error.message}`);
  }
  return error;
}
