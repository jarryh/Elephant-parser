import { NO_FILTERS, type Filters } from './filter';

/** Your edits to one file. They are stored next to the project, never in the Lua file. */
export interface Workspace {
  /** Goes up on every save, so that two tabs can't overwrite each other's edits. */
  revision: number;
  /** Item IDs. IDs that are no longer in the file are kept. */
  removed: string[];
  filters: Filters;
}

export const EMPTY_WORKSPACE: Workspace = { revision: 0, removed: [], filters: NO_FILTERS };

const MAX_IDS = 500_000;

/** Validates data from disk or from the browser. Null means it's unusable. */
export function parseWorkspace(value: unknown): Workspace | null {
  if (!isRecord(value)) return null;
  const { revision, removed, filters } = value;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return null;
  if (!Array.isArray(removed) || removed.length > MAX_IDS) return null;
  if (!removed.every((id): id is string => typeof id === 'string' && /^[0-9a-z]{1,16}$/.test(id))) return null;
  if (!isRecord(filters)) return null;

  const list = (key: keyof Filters) => {
    const found = filters[key];
    return Array.isArray(found) ? found.filter((entry): entry is string => typeof entry === 'string') : [];
  };
  const time = (key: keyof Filters) => {
    const found = filters[key];
    return typeof found === 'number' && Number.isFinite(found) ? found : null;
  };

  return {
    revision,
    removed: [...new Set(removed)],
    filters: {
      owners: list('owners'),
      channels: list('channels'),
      types: list('types'),
      senders: list('senders'),
      places: list('places'),
      text: typeof filters.text === 'string' ? filters.text : NO_FILTERS.text,
      from: time('from'),
      to: time('to'),
      showMarkers: filters.showMarkers === true,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
