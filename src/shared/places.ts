import type { Place } from './types';

/** Between a zone and a place within it, in filters. */
export const WITHIN = ' › ';

function zoneOf(place: Place): string | undefined {
  return place.zone ?? place.inst;
}

/** What narrows a place down within its zone. */
function details(place: Place): string[] {
  const zone = zoneOf(place);
  const names = [place.inst, place.neighborhood, place.house, place.sub, place.mini];
  return [...new Set(names.filter((name): name is string => !!name && name !== zone))];
}

/** "Stormwind City, Cathedral Square". Empty if the game gave no names. */
export function placeName(place: Place | undefined): string {
  if (!place) return '';
  return [zoneOf(place), ...details(place)].filter(Boolean).join(', ');
}

/** The filter values a place counts for: its zone, and itself within that zone. */
export function placeKeys(place: Place): string[] {
  const zone = zoneOf(place);
  if (!zone) return [];
  const within = details(place).join(', ');
  return within ? [zone, `${zone}${WITHIN}${within}`] : [zone];
}

/** "52.3, 67.1 · indoors", for a tooltip. */
export function placeDetails(place: Place): string {
  const parts: string[] = [];
  if (place.x !== undefined && place.y !== undefined) {
    parts.push(`${(place.x * 100).toFixed(1)}, ${(place.y * 100).toFixed(1)}`);
  } else {
    parts.push('no coordinates');
  }
  if (place.indoors !== undefined) parts.push(place.indoors ? 'indoors' : 'outdoors');
  return parts.join(' · ');
}
