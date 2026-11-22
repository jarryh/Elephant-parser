import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EMPTY_WORKSPACE, parseWorkspace, type Workspace } from '../shared/workspace';
import { atomicWrite } from './atomicWrite';
import { HttpError } from './errors';

export class WorkspaceStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string) {}

  /** `name` must already be checked against the Data/ listing. */
  async read(name: string): Promise<Workspace> {
    let text: string;
    try {
      text = await readFile(this.fileFor(name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_WORKSPACE;
      throw error;
    }

    let workspace: Workspace | null = null;
    try {
      workspace = parseWorkspace(JSON.parse(text));
    } catch {
      // Not JSON, which is reported below.
    }
    // Don't start afresh silently: the next save would destroy the damaged file.
    if (!workspace) {
      throw new HttpError(500, `workspace/${name}.json is damaged. Fix it, or delete it to start without edits.`);
    }
    return workspace;
  }

  /** Saves if `next.revision` is still current. Returns the new revision. */
  write(name: string, next: Workspace): Promise<number> {
    const result = this.queue.then(async () => {
      const current = await this.read(name);
      if (current.revision !== next.revision) {
        throw new HttpError(409, 'These edits were changed in another tab. Refresh this page to continue.');
      }
      const revision = current.revision + 1;
      await atomicWrite(this.fileFor(name), JSON.stringify({ ...next, revision }));
      return revision;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private fileFor(name: string): string {
    return path.join(this.dir, `${name}.json`);
  }
}
