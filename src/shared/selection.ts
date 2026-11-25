import { createMatcher, type Filters } from './filter';
import type { LogDocument, LogItem } from './types';

/**
 * kept: goes into an export.
 * removed: removed by you.
 * out: hidden by the filters.
 */
export type EntryState = 'kept' | 'removed' | 'out';

export interface Selection {
  /** Everything that matches the filters, removed or not. This is what the chat shows. */
  matched: LogItem[];
  /** The matching messages that are not removed. Exports and stories use these. */
  messages: LogItem[];
  /** Parallel to `doc.entries`. */
  states: EntryState[];
}

/**
 * The one definition of "the selection", so chat, raw Lua, exports and stories agree.
 *
 * For Lua, a message that is in several logs only stays in the selected channels, and
 * Elephant's markers and spacers stay unless removed, because Elephant relies on them.
 * StoryLog doesn't, so its notes follow the filters: they can be private.
 */
export function computeSelection(doc: LogDocument, filters: Filters, removed: ReadonlySet<string>): Selection {
  const matches = createMatcher(filters, doc.places);
  const matched = doc.items.filter(matches);
  const messages = matched.filter((item) => item.kind === 'message' && !removed.has(item.id));

  const selected = new Set(messages.map((item) => item.id));
  const candidates = doc.format === 'storylog' ? matched : doc.items;
  const structural = new Set(candidates.filter((item) => item.kind !== 'message').map((item) => item.id));
  const channels = new Set(filters.channels);

  const states = doc.entries.map(({ id, log }): EntryState => {
    if (removed.has(id)) return 'removed';
    if (structural.has(id)) return 'kept';
    if (!selected.has(id)) return 'out';
    return !channels.size || channels.has(doc.logs[log]!.channel) ? 'kept' : 'out';
  });

  return { matched, messages, states };
}
