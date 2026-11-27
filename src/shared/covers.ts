import type { LogDocument } from './types';

/**
 * True when `next` holds every line of `old`, so nothing is lost if it takes the older
 * file's place. Only StoryLog files qualify: a session in one never changes once it is
 * saved, and its lines have IDs that don't depend on the rest of the file. An Elephant
 * file can lose old lines without a trace, so it never covers anything.
 */
export function holdsAll(next: LogDocument, old: LogDocument): boolean {
  if (next.format !== 'storylog' || old.format !== 'storylog') return false;
  const ids = new Set(next.items.map((item) => item.id));
  return old.items.every((item) => ids.has(item.id));
}
