/** What the map shows, worked out apart from how it is drawn. */
import { isNpc } from './format';
import type { LogItem, Place } from './types';

/** One speaker on one spot. */
export interface Dot {
  key: string;
  speaker: string;
  name: string;
  npc: boolean;
  /** False when it's only where the recorder was, and the speaker somewhere around. */
  exact: boolean;
  /** An index into the document's places. */
  place: number;
  x: number;
  y: number;
  items: LogItem[];
  /** This is the `nth` of `of` dots on the same spot. */
  nth: number;
  of: number;
}

/** The part of a map in view, in map units. It is square in them, as the dots' scale is. */
export interface View {
  left: number;
  top: number;
  size: number;
}

/** The narrowest view: about 100 yards across a zone map. */
const MIN_VIEW = 0.03;
/** Spots closer than this part of the view would be drawn as one anyway. */
const CELLS_ACROSS = 50;
/** In the drawing's units: clear of a ring of dots around the spot. */
const LABEL_LIFT = 58;
/** As maps are three wide to two high. */
const CELLS_DOWN = Math.round((CELLS_ACROSS * 2) / 3);

/** Heard only near the speaker, so the recorder's place says roughly where they were. */
const NEARBY_TYPES = new Set([
  'SAY',
  'YELL',
  'EMOTE',
  'TEXT_EMOTE',
  'MONSTER_SAY',
  'MONSTER_YELL',
  'MONSTER_EMOTE',
  'ROLL',
  // The recorder's own, so they are drawn where the recorder stood.
  'QUEST_ACCEPTED',
  'QUEST_TURNED_IN',
]);
/** Heard anywhere, so only the speaker's own position says where they were. */
const GROUP_TYPES = new Set([
  'PARTY',
  'PARTY_LEADER',
  'RAID',
  'RAID_LEADER',
  'RAID_WARNING',
  'INSTANCE_CHAT',
  'INSTANCE_CHAT_LEADER',
]);

/**
 * The place a line is drawn at, and whether the speaker was exactly there.
 * Null for lines that no place can be given to: guild chat, whispers and channels
 * reach you anywhere, so where you stood says nothing about the speaker.
 */
function spotOf(item: LogItem, places: readonly Place[]): { index: number; place: Place; exact: boolean } | null {
  const nearby = NEARBY_TYPES.has(item.type);
  if (!nearby && !GROUP_TYPES.has(item.type)) return null;

  const own = item.speakerPlace === undefined ? undefined : places[item.speakerPlace];
  if (own?.x !== undefined && own.map !== undefined) return { index: item.speakerPlace!, place: own, exact: true };
  const here = item.place === undefined ? undefined : places[item.place];
  if (here?.x === undefined || here.map === undefined) return null;
  if (item.self) return { index: item.place!, place: here, exact: true };
  return nearby ? { index: item.place!, place: here, exact: false } : null;
}

/** The maps with lines on them, the busiest first. */
export function mapChoices(
  items: readonly LogItem[],
  places: readonly Place[],
): { map: number; name: string; lines: number }[] {
  const lines = new Map<number, number>();
  for (const item of items) {
    const spot = spotOf(item, places);
    if (spot) lines.set(spot.place.map!, (lines.get(spot.place.map!) ?? 0) + 1);
  }

  const names = new Map<number, Map<string, number>>();
  for (const { map, zone } of places) {
    if (map === undefined || !zone) continue;
    const tally = names.get(map) ?? new Map<string, number>();
    tally.set(zone, (tally.get(zone) ?? 0) + 1);
    names.set(map, tally);
  }

  return [...lines]
    .map(([map, count]) => ({
      map,
      lines: count,
      name: [...(names.get(map) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Map',
    }))
    .sort((a, b) => b.lines - a.lines);
}

export function mapDots(items: readonly LogItem[], places: readonly Place[], map: number): Dot[] {
  const dots = new Map<string, Dot>();

  for (const item of items) {
    const spot = spotOf(item, places);
    if (!spot || spot.place.map !== map) continue;
    const x = spot.place.x!;
    const y = spot.place.y!;
    const speaker = item.sender ?? '';
    const position = `${x},${y}`;
    const key = `${position}|${spot.exact}|${speaker}`;

    let dot = dots.get(key);
    if (!dot) {
      dot = {
        key,
        speaker,
        name: item.rpName ?? (speaker || 'No sender'),
        npc: isNpc(item),
        exact: spot.exact,
        place: spot.index,
        x,
        y,
        items: [],
        nth: 0,
        of: 1,
      };
      dots.set(key, dot);
    }
    dot.items.push(item);
  }
  return [...dots.values()];
}

/**
 * The dots as drawn in a view: spots too close to tell apart become one, and speakers who
 * share a spot get their turn around it. Months of walking would be thousands of dots otherwise.
 */
export function groupDots(dots: readonly Dot[], view: View): Dot[] {
  const cells = new Map<string, Map<string, Dot>>();
  for (const dot of dots) {
    const column = Math.floor(((dot.x - view.left) / view.size) * CELLS_ACROSS);
    const row = Math.floor(((dot.y - view.top) / view.size) * CELLS_DOWN);
    const cellKey = `${column},${row}`;
    let cell = cells.get(cellKey);
    if (!cell) {
      cell = new Map();
      cells.set(cellKey, cell);
    }

    const who = `${dot.exact}|${dot.speaker}`;
    const known = cell.get(who);
    if (known) {
      for (const item of dot.items) known.items.push(item);
    } else {
      // The first dot in a cell gives all of it its position.
      const first = cell.values().next().value as Dot | undefined;
      cell.set(who, { ...dot, x: first?.x ?? dot.x, y: first?.y ?? dot.y, items: [...dot.items] });
    }
  }

  return [...cells.values()].flatMap((cell) => {
    const group = [...cell.values()];
    group.forEach((dot, nth) => {
      dot.nth = nth;
      dot.of = group.length;
      dot.items.sort((a, b) => a.at - b.at);
    });
    return group;
  });
}

export function speakerTally(dots: readonly Dot[]): { key: string; name: string; npc: boolean; lines: number }[] {
  const people = new Map<string, { key: string; name: string; npc: boolean; lines: number }>();
  for (const { speaker, name, npc, items } of dots) {
    const person = people.get(speaker) ?? { key: speaker, name, npc, lines: 0 };
    person.lines += items.length;
    people.set(speaker, person);
  }
  return [...people.values()].sort((a, b) => b.lines - a.lines);
}

/**
 * Who has a colour. A colour stays with its speaker, so this changes nothing while any
 * coloured speaker is in view. Only when none is does it hand the colours to the busiest
 * players in view, so that the map is never all grey.
 */
export function fillColours(
  coloured: readonly (string | null)[],
  people: readonly { key: string; npc: boolean }[],
): readonly (string | null)[] {
  if (coloured.some((key) => key !== null && people.some((person) => person.key === key))) return coloured;
  const players = people.filter((person) => !person.npc);
  if (!players.length) return coloured;
  return coloured.map((_, slot) => players[slot]?.key ?? null);
}

/** Zooms to the dots, staying on the map. */
export function fitView(dots: readonly Pick<Dot, 'x' | 'y'>[]): View {
  if (!dots.length) return { left: 0, top: 0, size: 1 };
  let [minX, maxX, minY, maxY] = [1, 0, 1, 0];
  for (const { x, y } of dots) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const size = Math.min(1, Math.max(MIN_VIEW, Math.max(maxX - minX, maxY - minY) * 1.4));
  const clamp = (middle: number) => Math.min(1 - size, Math.max(0, middle - size / 2));
  return { left: clamp((minX + maxX) / 2), top: clamp((minY + maxY) / 2), size };
}

/** Grid lines at round coordinates, counted 0 to 100 as the game does. */
export function gridLines({ left, top, size }: View): Record<'x' | 'y', { at: number; label: string }[]> {
  const step = [0.5, 1, 2, 5, 10, 20].find((value) => value >= (size * 100) / 8) ?? 20;
  const lines = (from: number) => {
    const found: { at: number; label: string }[] = [];
    for (let n = Math.floor((from * 100) / step) + 1; n * step < (from + size) * 100; n++) {
      found.push({ at: (n * step) / 100, label: String(n * step) });
    }
    return found;
  };
  return { x: lines(left), y: lines(top) };
}

/** Subzone names over the middle of their dots. The busiest win where names would overlap. */
export function placeLabels(
  dots: readonly Dot[],
  places: readonly Place[],
  view: View,
  width: number,
  height: number,
): { text: string; x: number; y: number }[] {
  const groups = new Map<string, { sumX: number; minY: number; lines: number }>();
  for (const dot of dots) {
    const text = places[dot.place]?.mini ?? places[dot.place]?.sub;
    if (!text) continue;
    const group = groups.get(text) ?? { sumX: 0, minY: 1, lines: 0 };
    group.sumX += dot.x * dot.items.length;
    group.minY = Math.min(group.minY, dot.y);
    group.lines += dot.items.length;
    groups.set(text, group);
  }

  const shown: { text: string; x: number; y: number; half: number }[] = [];
  for (const [text, group] of [...groups].sort((a, b) => b[1].lines - a[1].lines)) {
    const half = Math.min(text.length * 6, width / 2);
    const middle = ((group.sumX / group.lines - view.left) / view.size) * width;
    const x = Math.min(width - half, Math.max(half, middle));
    const y = Math.min(height - 8, Math.max(24, ((group.minY - view.top) / view.size) * height - LABEL_LIFT));
    if (shown.some((other) => Math.abs(other.x - x) < other.half + half && Math.abs(other.y - y) < 26)) continue;
    shown.push({ text, x, y, half });
  }
  return shown.map(({ text, x, y }) => ({ text, x, y }));
}
