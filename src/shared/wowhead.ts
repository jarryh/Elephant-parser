/** Plain links to Wowhead. Nothing is loaded from there until you click one. */
import { isNpc } from './format';
import type { LogDocument, LogItem, Place, Speaker } from './types';
import { FOREVER_ZONES } from './zones';

export type Game = 'forever' | 'retail';

const BASE: Record<Game, string> = {
  forever: 'https://www.wowhead.com/forever',
  retail: 'https://www.wowhead.com',
};

const SHARED = ' (shared)';

/**
 * StoryLog saves the game's version. Elephant doesn't, but it names characters
 * "First Surname" in WoW Forever and "Name - Realm" elsewhere.
 */
export function gameOf(doc: Pick<LogDocument, 'gameVersion' | 'logs'>): Game {
  const version = doc.gameVersion;
  if (version !== undefined) return version >= 16000 && version < 20000 ? 'forever' : 'retail';
  const characters = doc.logs.map((log) => log.owner).filter((owner) => !owner.endsWith(SHARED));
  return characters.length && characters.every((owner) => !owner.includes(' - ')) ? 'forever' : 'retail';
}

function searchUrl(game: Game, name: string): string {
  return `${BASE[game]}/search?q=${encodeURIComponent(name)}`;
}

/** For a target from `parseMarkup`, such as `item=19019`. */
export function linkUrl(game: Game, target: string): string {
  return `${BASE[game]}/${target}`;
}

export function zoneUrl(game: Game, place: Place): string | null {
  // A dungeon has its own page, and no map of the zones.
  if (place.inst) return searchUrl(game, place.inst);
  const area = game === 'forever' && place.map !== undefined ? FOREVER_ZONES[place.map] : undefined;
  if (area) return `${BASE[game]}/zone=${area}`;
  return place.zone ? searchUrl(game, place.zone) : null;
}

/** NPCs only: Wowhead has no players, and their names are nobody else's business. */
export function npcUrl(game: Game, item: LogItem, speakers: readonly Speaker[] = []): string | null {
  if (!item.sender || !isNpc(item)) return null;
  const id = item.speaker === undefined ? undefined : speakers[item.speaker]?.npcId;
  return id ? `${BASE[game]}/npc=${id}` : searchUrl(game, item.sender);
}
