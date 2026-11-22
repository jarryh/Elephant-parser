import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_FILTERS } from '../src/shared/filter';
import type { Workspace } from '../src/shared/workspace';
import { ApiError } from '../src/web/api';
import { Saver, type SaveStatus } from '../src/web/saver';

const snapshot = (...removed: string[]) => ({ removed, filters: NO_FILTERS });

beforeEach(() => {
  // Only these: faking performance.now makes Vitest think its own hooks timed out.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Saver', () => {
  it('waits, then saves only the newest change', async () => {
    const save = vi.fn<(workspace: Workspace) => Promise<number>>().mockResolvedValue(1);
    const saver = new Saver(0, save, 100);
    saver.update(snapshot('a'));
    saver.update(snapshot('a', 'b'));
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...snapshot('a', 'b'), revision: 0 });
    expect(saver.dirty).toBe(false);
  });

  it('queues a change made during a save, with the new revision', async () => {
    let finish!: (revision: number) => void;
    const save = vi
      .fn<(workspace: Workspace) => Promise<number>>()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue(6);
    const saver = new Saver(4, save, 100);

    saver.update(snapshot('a'));
    await vi.advanceTimersByTimeAsync(100);
    saver.update(snapshot('b'));
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);

    finish(5);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenLastCalledWith({ ...snapshot('b'), revision: 5 });
  });

  it('keeps a failed change for a retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError(0, 'offline')).mockResolvedValue(1);
    const saver = new Saver(0, save, 100);
    const statuses: SaveStatus[] = [];
    saver.onStatus = (status) => statuses.push(status);

    saver.update(snapshot('a'));
    await vi.advanceTimersByTimeAsync(100);
    expect(statuses.at(-1)).toEqual({ state: 'failed', message: 'offline', canRetry: true });
    expect(saver.dirty).toBe(true);

    await saver.flush();
    expect(statuses.at(-1)).toEqual({ state: 'saved' });
  });

  it('stops after a conflict with another tab', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'changed'));
    const saver = new Saver(0, save, 100);
    saver.update(snapshot('a'));
    await vi.advanceTimersByTimeAsync(100);
    saver.update(snapshot('b'));
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
