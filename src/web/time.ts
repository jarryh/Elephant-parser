import { createClock } from '../shared/format';

/** Formats in the browser's timezone. */
export const clock = createClock();

/** Unix seconds -> the value of a datetime-local input. */
export function toInput(time: number | null): string {
  return time === null ? '' : `${clock.day(time)}T${clock.time(time)}`;
}

/** The value of a datetime-local input -> Unix seconds. An end includes its whole minute. */
export function fromInput(value: string, edge: 'start' | 'end'): number | null {
  const ms = value ? new Date(value).getTime() : NaN;
  if (Number.isNaN(ms)) return null;
  const minute = Math.floor(ms / 60_000) * 60;
  return edge === 'start' ? minute : minute + 59;
}

/** The first and last second of a local YYYY-MM-DD day. */
export function dayRange(day: string): { from: number; to: number } {
  const start = new Date(`${day}T00:00`);
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return { from: start.getTime() / 1000, to: next.getTime() / 1000 - 1 };
}

export function dayTitle(day: string): string {
  return new Date(`${day}T12:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
