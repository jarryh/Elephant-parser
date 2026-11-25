import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DataFile, LoadedFile } from '../shared/api';
import { NotElephantFileError, parseElephant } from '../shared/elephant';
import { LuaParseError } from '../shared/lua';
import { HttpError } from './errors';

/** Read-only access to Data/. Nothing in this module writes. */
export class DataFiles {
  private readonly cache = new Map<string, LoadedFile>();

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

  async load(name: string): Promise<LoadedFile> {
    const file = await this.find(name);
    const cached = this.cache.get(name);
    if (cached && cached.file.modified === file.modified && cached.file.size === file.size) return cached;

    const source = await readFile(path.join(this.dir, name), 'utf8');
    try {
      const loaded = { file, document: parseElephant(source) };
      this.cache.set(name, loaded);
      return loaded;
    } catch (error) {
      if (error instanceof LuaParseError || error instanceof NotElephantFileError) {
        throw new HttpError(422, `Could not read ${name}. ${error.message}`);
      }
      throw error;
    }
  }
}
