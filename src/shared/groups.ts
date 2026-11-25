/** Who the recorder was in a party or raid with. Only StoryLog records it. */
import type { Group, LogDocument, LogItem, Speaker } from './types';

/** The part of a document that says who is who. */
export type Cast = Pick<LogDocument, 'speakers' | 'groups'>;

/** The other members, by roleplay name where they have one. */
export function memberNames(group: Group | undefined, speakers: readonly Speaker[] = []): string[] {
  return (group?.members ?? []).flatMap((index) => {
    const who = speakers[index];
    return who ? [who.rp ?? who.name] : [];
  });
}

/** "Party: A, B" or "Raid (12): A, B, ...", counting the recorder. Empty without a group. */
export function groupName(group: Group | undefined, speakers: readonly Speaker[] = []): string {
  const names = memberNames(group, speakers);
  if (!group || !names.length) return '';
  return `${group.raid ? `Raid (${names.length + 1})` : 'Party'}: ${names.join(', ')}`;
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
