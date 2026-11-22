import type { LogDocument, LogItem } from './types';

/** An empty list means "all". */
export interface Filters {
  owners: string[];
  channels: string[];
  types: string[];
  senders: string[];
  text: string;
  /** Unix seconds, inclusive. */
  from: number | null;
  to: number | null;
  showMarkers: boolean;
}

export const NO_FILTERS: Filters = {
  owners: [],
  channels: [],
  types: [],
  senders: [],
  text: '',
  from: null,
  to: null,
  showMarkers: false,
};

/** The types that usually make up a roleplay scene. */
export const RP_TYPES = [
  'SAY',
  'YELL',
  'EMOTE',
  'TEXT_EMOTE',
  'PARTY',
  'PARTY_LEADER',
  'RAID',
  'RAID_LEADER',
  'RAID_WARNING',
  'MONSTER_SAY',
  'MONSTER_YELL',
  'MONSTER_EMOTE',
  'MONSTER_WHISPER',
];

/** Lower-cases and drops accents, so "elowyn" finds "Élowyn". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const searchable = new WeakMap<LogItem, string>();
function searchText(item: LogItem): string {
  let value = searchable.get(item);
  if (value === undefined) {
    value = fold(`${item.sender ?? ''} ${item.text}`);
    searchable.set(item, value);
  }
  return value;
}

export function createMatcher(filters: Filters): (item: LogItem) => boolean {
  const owners = new Set(filters.owners);
  const channels = new Set(filters.channels);
  const types = new Set(filters.types);
  const senders = new Set(filters.senders);
  const text = fold(filters.text.trim());
  const { from, to, showMarkers } = filters;

  return (item) => {
    if (item.kind === 'spacer' || (item.kind === 'marker' && !showMarkers)) return false;
    if (from !== null && item.at < from) return false;
    if (to !== null && item.at > to) return false;
    if (owners.size && !owners.has(item.owner)) return false;
    if (channels.size && !item.channels.some((channel) => channels.has(channel))) return false;
    if (types.size && !types.has(item.type)) return false;
    if (senders.size && (item.sender === null || !senders.has(item.sender))) return false;
    return !text || searchText(item).includes(text);
  };
}

export interface Facets {
  owners: Map<string, number>;
  channels: Map<string, number>;
  types: Map<string, number>;
  senders: Map<string, number>;
  days: Map<string, number>;
}

/**
 * Message counts for the filter lists. Channels, types and senders follow the chosen
 * characters and period. Days follow the characters, and characters count everything.
 */
export function computeFacets(
  doc: LogDocument,
  filters: Pick<Filters, 'owners' | 'from' | 'to'>,
  dayOf: (time: number) => string,
): Facets {
  const facets: Facets = {
    owners: new Map(),
    channels: new Map(),
    types: new Map(),
    senders: new Map(),
    days: new Map(),
  };
  const add = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  const owners = new Set(filters.owners);

  for (const item of doc.items) {
    if (item.kind !== 'message') continue;
    add(facets.owners, item.owner);
    if (owners.size && !owners.has(item.owner)) continue;
    add(facets.days, dayOf(item.at));
    if (filters.from !== null && item.at < filters.from) continue;
    if (filters.to !== null && item.at > filters.to) continue;
    for (const channel of item.channels) add(facets.channels, channel);
    if (item.type) add(facets.types, item.type);
    if (item.sender) add(facets.senders, item.sender);
  }
  return facets;
}

export function channelLabels(doc: LogDocument): Map<string, string> {
  const labels = new Map<string, string>();
  for (const log of doc.logs) if (!labels.has(log.channel)) labels.set(log.channel, log.label);
  return labels;
}

/** Built-in logs in Elephant's order, then named channels alphabetically. */
export function compareChannels(a: string, b: string): number {
  const aBuiltIn = a.startsWith('#');
  const bBuiltIn = b.startsWith('#');
  if (aBuiltIn && bBuiltIn) return Number(a.slice(1)) - Number(b.slice(1));
  if (aBuiltIn !== bBuiltIn) return aBuiltIn ? -1 : 1;
  return a.localeCompare(b);
}
