import { OPEN_EVENT_TYPES } from './events';
import { placeKeys } from './places';
import type { LogDocument, LogItem, Place } from './types';

/** An empty list means "all". */
export interface Filters {
  owners: string[];
  channels: string[];
  types: string[];
  senders: string[];
  /** Zones, and places within them: see `placeKeys`. */
  places: string[];
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
  places: [],
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
  'ROLL',
  'QUEST_ACCEPTED',
  'QUEST_TURNED_IN',
  // What happened: trades, travel, fights, NPC dialogue. Not letters, which are private.
  ...OPEN_EVENT_TYPES,
];

/** Lower-cases and drops accents, so "elowyn" finds "Élowyn". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const searchable = new WeakMap<LogItem, string>();
function searchText(item: LogItem): string {
  let value = searchable.get(item);
  if (value === undefined) {
    value = fold([item.sender ?? '', ...(item.rpName ? [item.rpName] : []), item.text, item.detail ?? ''].join(' '));
    searchable.set(item, value);
  }
  return value;
}

/**
 * StoryLog's own lines. They show without "Show markers", and have no channel, type or
 * sender to filter by. Stories get them too.
 */
export const ANNOTATIONS: ReadonlySet<string> = new Set(['NOTE', 'HIDDEN', 'GROUP']);

export function createMatcher(filters: Filters, places: readonly Place[] = []): (item: LogItem) => boolean {
  const owners = new Set(filters.owners);
  const channels = new Set(filters.channels);
  const types = new Set(filters.types);
  const senders = new Set(filters.senders);
  const text = fold(filters.text.trim());
  const { from, to, showMarkers } = filters;
  const wantedPlaces = new Set(filters.places);
  const inPlace = wantedPlaces.size
    ? places.map((place) => placeKeys(place).some((key) => wantedPlaces.has(key)))
    : null;

  return (item) => {
    if (item.kind === 'spacer') return false;
    const annotation = item.kind === 'marker' && ANNOTATIONS.has(item.type);
    if (item.kind === 'marker' && !annotation && !showMarkers) return false;
    if (from !== null && item.at < from) return false;
    if (to !== null && item.at > to) return false;
    if (owners.size && !owners.has(item.owner)) return false;
    if (inPlace && (item.place === undefined || !inPlace[item.place])) return false;
    if (annotation) return !text || searchText(item).includes(text);
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
  places: Map<string, number>;
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
    places: new Map(),
    days: new Map(),
  };
  const add = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  const owners = new Set(filters.owners);
  const keys = (doc.places ?? []).map(placeKeys);

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
    if (item.place !== undefined) for (const key of keys[item.place]!) add(facets.places, key);
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
