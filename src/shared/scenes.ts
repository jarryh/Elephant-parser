/** Splits the roleplay of each character into scenes, and says who was in each. */
import { RP_TYPES } from './filter';
import { isNpc } from './format';
import { placeName } from './places';
import type { LogItem, Place } from './types';

export const SCENE_GAP = 20 * 60;
/** In yards, for say and emotes. The wiki's figure, which Blizzard hasn't confirmed. */
export const EARSHOT = 60;
/** Twice earshot: from there, nobody who heard the start can hear you. */
export const SCENE_RADIUS = EARSHOT * 2;

const SCENE_TYPES = new Set(RP_TYPES);
/**
 * Only these move a scene along. Party and raid chat reach you anywhere, so a ride
 * through the countryside while talking in party is still one scene.
 */
const LOCAL_TYPES = new Set(['SAY', 'YELL', 'EMOTE', 'TEXT_EMOTE', 'NOTE']);

export interface Participant {
  name: string;
  lines: number;
  npc: boolean;
}

export interface Scene {
  /** The ID of its first item. */
  id: string;
  owner: string;
  from: number;
  to: number;
  /** Where most of its lines were. Empty if unknown. */
  place: string;
  /** From `/storylog note`. */
  name: string;
  lines: number;
  /** The busiest first. */
  participants: Participant[];
  ids: string[];
}

interface Open {
  owner: string;
  items: LogItem[];
  to: number;
  /** Where its talk began. */
  anchor?: Place;
  last?: Place;
  /** NPC lines since the last line from a player. */
  ambient: LogItem[];
}

export function computeScenes(items: readonly LogItem[], places: readonly Place[] = []): Scene[] {
  const open = new Map<string, Open>();
  const all: Open[] = [];

  for (const item of items) {
    const note = item.kind === 'marker' && item.type === 'NOTE';
    if (!note && !(item.kind === 'message' && SCENE_TYPES.has(item.type))) continue;

    let scene = open.get(item.owner);
    // NPCs talk whether or not anyone is roleplaying. So they never start a scene, move it
    // or keep it going: they only join one that a player's line carries on.
    if (isNpc(item)) {
      scene?.ambient.push(item);
      continue;
    }

    const place = item.place === undefined ? undefined : places[item.place];
    const local = LOCAL_TYPES.has(item.type);

    if (!scene || endsScene(scene, item.at, place, local)) {
      scene = { owner: item.owner, items: [], to: item.at, ambient: [] };
      open.set(item.owner, scene);
      all.push(scene);
    } else {
      scene.items.push(...scene.ambient);
      scene.ambient = [];
    }
    scene.items.push(item);
    scene.to = item.at;
    if (place) scene.last = place;
    if (place && local) scene.anchor ??= place;
  }

  // A note on its own isn't a scene.
  return all
    .map((scene) => describe(scene, places))
    .filter((scene) => scene.participants.some((person) => !person.npc));
}

function endsScene(scene: Open, at: number, place: Place | undefined, local: boolean): boolean {
  if (at - scene.to > SCENE_GAP) return true;
  if (!place) return false;
  if (scene.last && (scene.last.inst !== place.inst || scene.last.house !== place.house)) return true;
  return local && scene.anchor !== undefined && movedAway(scene.anchor, place);
}

function movedAway(from: Place, to: Place): boolean {
  if (from.map !== undefined && to.map !== undefined && from.map !== to.map) return true;
  if (from.wx !== undefined && from.wy !== undefined && to.wx !== undefined && to.wy !== undefined) {
    return from.cont !== to.cont || Math.hypot(from.wx - to.wx, from.wy - to.wy) > SCENE_RADIUS;
  }
  // Without distances, as on a client that gives none, the zone has to do.
  return from.map === undefined && to.map === undefined && from.zone !== to.zone;
}

function describe({ owner, items, to }: Open, places: readonly Place[]): Scene {
  const people = new Map<string, Participant>();
  const placeLines = new Map<string, number>();
  const notes: string[] = [];
  let lines = 0;

  for (const item of items) {
    if (item.kind === 'marker') {
      notes.push(item.text.replace(/^Note: /, ''));
      continue;
    }
    lines++;
    const where = item.place === undefined ? '' : placeName(places[item.place]);
    if (where) placeLines.set(where, (placeLines.get(where) ?? 0) + 1);
    if (!item.sender) continue;

    const npc = isNpc(item);
    const key = `${npc}:${item.sender}`;
    const person = people.get(key) ?? { name: item.sender, lines: 0, npc };
    person.lines++;
    if (item.rpName) person.name = item.rpName;
    people.set(key, person);
  }

  return {
    id: items[0]!.id,
    owner,
    from: items[0]!.at,
    to,
    place: [...placeLines].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
    name: notes.join(' · '),
    lines,
    participants: [...people.values()].sort((a, b) => b.lines - a.lines),
    ids: items.map((item) => item.id),
  };
}
