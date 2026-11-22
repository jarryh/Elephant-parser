import type { Workspace } from '../shared/workspace';
import { ApiError } from './api';

export type Snapshot = Omit<Workspace, 'revision'>;
export type SaveStatus =
  | { state: 'saved' }
  | { state: 'saving' }
  | { state: 'failed'; message: string; canRetry: boolean };

/** Saves one change at a time, always ending with the newest. */
export class Saver {
  onStatus: (status: SaveStatus) => void = () => {};

  private pending: Snapshot | null = null;
  private running = false;
  private conflicted = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private revision: number,
    private readonly save: (workspace: Workspace) => Promise<number>,
    private readonly delay = 350,
  ) {}

  get dirty(): boolean {
    return this.running || this.pending !== null;
  }

  update(snapshot: Snapshot): void {
    this.pending = snapshot;
    if (this.conflicted) return;
    this.onStatus({ state: 'saving' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running || this.conflicted || !this.pending) return;

    const snapshot = this.pending;
    this.pending = null;
    this.running = true;
    try {
      this.revision = await this.save({ ...snapshot, revision: this.revision });
    } catch (error) {
      this.running = false;
      this.pending ??= snapshot;
      this.conflicted = error instanceof ApiError && error.status === 409;
      this.onStatus({
        state: 'failed',
        message: error instanceof Error ? error.message : String(error),
        canRetry: !this.conflicted,
      });
      return;
    }

    this.running = false;
    if (this.pending) await this.flush();
    else this.onStatus({ state: 'saved' });
  }
}
