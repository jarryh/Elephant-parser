/** Who the recorder was in a party or raid with. Only StoryLog records it. */
import type { Group, LogDocument, LogItem, Speaker } from './types';

/** The part of a document that says who is who. */
export type Cast = Pick<LogDocument, 'speakers' | 'groups'>;

const nameOf = (who: Speaker) => who.rp ?? who.name;

/** The other members, by roleplay name where they have one. */
export function memberNames(group: Group | undefined, speakers: readonly Speaker[] = []): string[] {
  return (group?.members ?? []).flatMap((index) => {
    const who = speakers[index];
    return who ? [nameOf(who)] : [];
  });
}

/**
 * "Party: A, B" or "Raid (12): A, B, ...", counting the recorder. Empty without a group.
 * The leader is marked, or named in front when it is the recorder.
 */
export function groupName(group: Group | undefined, speakers: readonly Speaker[] = []): string {
  if (!group) return '';
  const names = group.members.flatMap((index) => {
    const who = speakers[index];
    return who ? [nameOf(who) + (index === group.leader ? ' (leader)' : '')] : [];
  });
  if (!names.length) return '';
  const kind = group.raid ? `Raid (${names.length + 1})` : 'Party';
  const leader = group.leader === undefined ? undefined : speakers[group.leader];
  if (!leader || group.members.includes(group.leader!)) return `${kind}: ${names.join(', ')}`;
  return `${kind}, led by ${nameOf(leader)}: ${names.join(', ')}`;
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Why a group ended, as the addon saves it. */
const ENDINGS: Record<string, string> = {
  disbanded: 'The group was disbanded',
  removed: 'Removed from the group',
};

/**
 * What a group line tells: who joined or left since the last one, and who is in it now.
 * `atStart` is for a line saved at login, where the recorder already was in the group.
 */
export function groupChange(
  before: Group | undefined,
  after: Group | undefined,
  speakers: readonly Speaker[],
  { atStart = false, why }: { atStart?: boolean; why?: string } = {},
): string {
  const now = groupName(after, speakers);
  if (!now) return (why && ENDINGS[why]) || 'Left the group';

  const people = memberNames(after, speakers);
  const kind = after!.raid ? 'raid' : 'party';
  const leader = after!.leader === undefined ? undefined : speakers[after!.leader];
  if (!before?.members.length) {
    const size = after!.raid ? ` (${people.length + 1})` : '';
    // The roster that follows a change would say who leads, and nothing follows this.
    const led = leader ? `, led by ${nameOf(leader)}` : '';
    return `${atStart ? 'In' : 'Joined'} a ${kind} with ${listNames(people)}${size}${led}`;
  }

  // By character name, so that a new roleplay name is not someone leaving and joining.
  const key = (index: number) => speakers[index]?.name;
  const had = new Set(before.members.map(key));
  const has = new Set(after!.members.map(key));
  const joined = after!.members.filter((index) => !had.has(key(index)));
  const left = before.members.filter((index) => !has.has(key(index)));
  const names = (indexes: number[]) => listNames(indexes.flatMap((index) => (speakers[index] ? [nameOf(speakers[index])] : [])));

  const changes: string[] = [];
  if (joined.length) changes.push(`${names(joined)} joined`);
  if (left.length) changes.push(`${names(left)} left`);
  if (!before.raid !== !after!.raid) changes.push(after!.raid ? 'the party became a raid' : 'the raid became a party');
  const ledBefore = before.leader === undefined ? undefined : speakers[before.leader]?.name;
  if (leader && ledBefore !== undefined && leader.name !== ledBefore) changes.push(`${nameOf(leader)} now leads`);
  if (!changes.length) return now;
  const told = changes.join(', ');
  return `${told[0]!.toUpperCase()}${told.slice(1)}. ${now}`;
}

/**
 * For walking through items in order: gives the group's name where it changes, an empty
 * string where the recorder is alone again, and null where nothing changed.
 */
export function groupChanges({ speakers, groups }: Cast): (item: LogItem) => string | null {
  let last = '';
  return (item) => {
    const name = item.group === undefined ? '' : groupName(groups?.[item.group], speakers);
    if (name === last) return null;
    last = name;
    return name;
  };
}
