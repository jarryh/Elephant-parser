import { lineTag, speaker, type Clock } from './format';
import { groupChanges, memberNames, type Cast } from './groups';
import type { EntryState } from './selection';
import { placeName } from './places';
import type { Entry, LogDocument, LogItem, Place } from './types';

/** One message as a line of plain text. */
export function plainLine(item: LogItem, clock: Clock): string {
  const who = speaker(item);
  const flag = item.flag ? `<${item.flag}> ` : '';
  const name = who ? who.before + who.name + who.after : '';
  return `[${clock.time(item.at)}] [${lineTag(item)}] ${flag}${name}${item.text.replace(/\r?\n/g, '\n    ')}`;
}

function byDay(items: LogItem[], clock: Clock): Map<string, LogItem[]> {
  const days = new Map<string, LogItem[]>();
  for (const item of items) {
    const day = clock.day(item.at);
    const list = days.get(day);
    if (list) list.push(item);
    else days.set(day, [item]);
  }
  return days;
}

/** Splits a day wherever the place changes. Items without a place stay where they are. */
function byPlace(items: LogItem[], places: readonly Place[]): { place: string; items: LogItem[] }[] {
  const parts: { place: string; items: LogItem[] }[] = [];
  for (const item of items) {
    const name = item.place === undefined ? '' : placeName(places[item.place]);
    const last = parts.at(-1);
    if (last && (!name || name === last.place)) last.items.push(item);
    else parts.push({ place: name, items: [item] });
  }
  return parts;
}

/** `places` and `cast` come from a StoryLog document. The group is named wherever it changes. */
export function exportText(items: LogItem[], clock: Clock, places: readonly Place[] = [], cast: Cast = {}): string {
  const change = groupChanges(cast);
  const line = (item: LogItem) => {
    const group = change(item);
    return [...(group === null ? [] : [`[Group] ${group || 'none'}`]), plainLine(item, clock)];
  };
  const sections = [...byDay(items, clock)].map(([day, list]) =>
    [
      `=== ${day} ===`,
      ...byPlace(list, places).flatMap((part) => [
        ...(part.place ? [`--- ${part.place} ---`] : []),
        ...part.items.flatMap(line),
      ]),
    ].join('\n'),
  );
  return `${sections.join('\n\n')}\n`;
}

export function exportMarkdown(
  items: LogItem[],
  clock: Clock,
  places: readonly Place[] = [],
  cast: Cast = {},
): string {
  const change = groupChanges(cast);
  const line = (item: LogItem) => {
    const who = speaker(item);
    const name = who ? `${escapeMarkdown(who.before)}**${escapeMarkdown(who.name)}**${escapeMarkdown(who.after)}` : '';
    const text = escapeMarkdown(item.text).replace(/\r?\n/g, '<br>');
    const group = change(item);
    const company = group === null ? '' : `- *Group* ${escapeMarkdown(group || 'none')}\n`;
    return `${company}- \`${clock.time(item.at)}\` *${escapeMarkdown(lineTag(item))}* ${name}${text}`;
  };
  const sections = [...byDay(items, clock)].map(([day, list]) => {
    const parts = byPlace(list, places).map(
      (part) => `${part.place ? `### ${escapeMarkdown(part.place)}\n\n` : ''}${part.items.map(line).join('\n')}`,
    );
    return `## ${day}\n\n${parts.join('\n\n')}`;
  });
  return `# Chat log\n\n${sections.join('\n\n')}\n`;
}

function escapeMarkdown(text: string): string {
  // Chat is other people's text: it must not turn into links, images or HTML.
  return text.replace(/[\\`*_[\]<>#|~!]/g, '\\$&');
}

export function exportJson(
  items: LogItem[],
  labels: ReadonlyMap<string, string>,
  places: readonly Place[] = [],
  { speakers, groups }: Cast = {},
): string {
  const messages = items.map((item) => ({
    time: new Date(item.at * 1000).toISOString(),
    unixTime: item.at,
    character: item.owner,
    channels: item.channels.map((channel) => labels.get(channel) ?? channel),
    channelName: item.channelName ?? null,
    type: item.type,
    sender: item.sender,
    flag: item.flag ?? null,
    text: item.text,
    // Only StoryLog files have these. An undefined value is left out.
    rpName: item.rpName,
    language: item.language,
    target: item.target,
    place: item.place === undefined ? undefined : places[item.place],
    speakerPlace: item.speakerPlace === undefined ? undefined : places[item.speakerPlace],
    group: item.group === undefined ? undefined : memberNames(groups?.[item.group], speakers),
    raid: (item.group !== undefined && groups?.[item.group]?.raid) || undefined,
    questId: item.quest,
  }));
  return `${JSON.stringify({ messages }, null, 2)}\n`;
}

interface Cut {
  start: number;
  end: number;
  text: string;
}

/**
 * The original file with everything that isn't kept cut out. The rest of the file,
 * settings included, stays byte for byte, with two exceptions:
 * - `[n] =` keys are renumbered, because a hole would hide the rest of the log from Lua.
 * - `hasMessage` becomes true if a log's last entry was cut. Otherwise Elephant would
 *   overwrite the new last entry with "Logging started" at the next login.
 */
export function exportLua(doc: LogDocument, states: EntryState[]): string {
  const { source, logs, entries } = doc;
  const cuts: Cut[] = [];

  // Keys are renumbered per Lua list, which several StoryLog logs share.
  const perList = new Map<number, { entry: Entry; kept: boolean }[]>();
  entries.forEach((entry, i) => {
    const key = logs[entry.log]!.list ?? entry.log;
    const list = perList.get(key) ?? [];
    list.push({ entry, kept: states[i] === 'kept' });
    perList.set(key, list);
  });

  for (const list of perList.values()) {
    if (list.every(({ kept }) => kept)) continue;

    const ordered = list
      .map((value) => ({ ...value, key: explicitKey(source, value.entry) }))
      .sort((a, b) => (a.key ?? 0) - (b.key ?? 0));

    let next = 0;
    for (const { entry, kept, key } of ordered) {
      if (!kept) {
        cuts.push(wholeLines(source, entry));
        continue;
      }
      next++;
      if (key !== null && key !== next) {
        cuts.push({ start: entry.start, end: entry.valueStart!, text: `[${next}] = ` });
      }
    }

    const log = logs[ordered[0]!.entry.log]!;
    if (!ordered.at(-1)!.kept && next > 0 && !log.hasMessage && log.hasMessageSpan) {
      const [start, end] = log.hasMessageSpan;
      cuts.push({ start, end, text: 'true' });
    }
  }

  cuts.sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let position = 0;
  for (const cut of cuts) {
    parts.push(source.slice(position, cut.start), cut.text);
    position = cut.end;
  }
  parts.push(source.slice(position));
  return parts.join('');
}

function explicitKey(source: string, entry: Entry): number | null {
  if (entry.valueStart === undefined) return null;
  const found = /^\[\s*(\d+)\s*\]/.exec(source.slice(entry.start, entry.valueStart));
  return found ? Number(found[1]) : null;
}

/** Widens an entry to its whole lines (indent, `-- [n]` comment, line break) when it has them to itself. */
function wholeLines(source: string, entry: Entry): Cut {
  let start = entry.start;
  while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start--;
  const startsLine = start === 0 || source[start - 1] === '\n' || source[start - 1] === '\r';
  if (!startsLine) return { start: entry.start, end: entry.end, text: '' };

  const tail = /[ \t]*(?:--(?!\[)[^\r\n]*)?(?:\r\n|\n|\r)/y;
  tail.lastIndex = entry.end;
  if (!tail.test(source)) return { start: entry.start, end: entry.end, text: '' };
  return { start, end: tail.lastIndex, text: '' };
}
