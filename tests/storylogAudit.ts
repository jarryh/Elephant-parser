/**
 * Compares a StoryLog file with what the reader made of it.
 *
 * The reader forgives: a place that isn't there just gives a line without a place. So a
 * file from the game could be read wrongly and still look fine. Everything here is a
 * number or a boolean, so that a failing test on a real file can't print names or chat.
 */
import { isDeepStrictEqual } from 'node:util';
import { exportLua } from '../src/shared/export';
import { NO_FILTERS, RP_TYPES, type Filters } from '../src/shared/filter';
import { parseLua } from '../src/shared/lua';
import { parseLog } from '../src/shared/parse';
import { placeKeys } from '../src/shared/places';
import { computeSelection } from '../src/shared/selection';
import type { LogDocument, LogItem } from '../src/shared/types';
import { field, referenceParse, toPlain, type Plain } from './helpers';

export interface Audit {
  /** Decoding as UTF-8 and encoding again gives the same bytes. */
  utf8: boolean;
  /** Our Lua parser sees what an independent one sees. */
  sameAsReference: boolean;
  /** Message tables in the file, over all sessions. */
  lines: number;
  entries: number;
  items: number;
  /** Distinct `e` values in the file, and distinct types in the document. */
  typesInFile: number;
  types: number;
  /** Characters of the sessions that have lines, and owners in the document. */
  charactersInFile: number;
  owners: number;
  /** Entries that don't begin and end on lines of their own. */
  misplaced: number;
  /** Items without a time. */
  undated: number;
  /** `p`, `sp`, `s` or `to` that point at nothing, and speakers without a name. */
  dangling: number;
  /** Lines whose place, speaker's place, speaker or target the reader did not pick up. */
  dropped: number;
  /** Exporting with everything kept gives the file back. */
  unchanged: boolean;
  /** Cut exports that aren't valid Lua, or don't hold exactly the kept messages. */
  badCuts: number;
}

const REFERENCES = ['p', 'sp', 's', 'to'] as const;
type Reference = (typeof REFERENCES)[number];

const tables = (list: Plain | undefined) =>
  Array.isArray(list) ? list.filter((entry): entry is [Plain, [Plain, Plain][]] => Array.isArray(entry[1])) : [];

export function auditStoryLog(bytes: Buffer): Audit {
  const source = bytes.toString('utf8');
  const reference = referenceParse(source);
  const doc = parseLog(source);

  let lines = 0;
  let dangling = 0;
  const typesInFile = new Set<string>();
  const characters = new Set<string>();
  const inFile: Record<Reference, number> = { p: 0, sp: 0, s: 0, to: 0 };

  for (const [, session] of tables(field(reference, 'sessions'))) {
    const places = new Set(tables(field(session, 'places')).map(([key]) => key));
    const speakers = new Set<Plain>();
    for (const [key, speaker] of tables(field(session, 'speakers'))) {
      if (field(speaker, 'name')) speakers.add(key);
      else dangling++;
    }

    const messages = tables(field(session, 'messages'));
    if (messages.length) characters.add(String(field(session, 'character') ?? ''));
    for (const [, message] of messages) {
      lines++;
      typesInFile.add(String(field(message, 'e') ?? ''));
      for (const key of REFERENCES) {
        const target = field(message, key);
        if (target === undefined) continue;
        inFile[key]++;
        if (!(key === 'p' || key === 'sp' ? places : speakers).has(target)) dangling++;
      }
    }
  }

  const count = (has: (item: LogItem) => boolean) => doc.items.filter(has).length;
  const inDocument: Record<Reference, number> = {
    p: count((item) => item.place !== undefined),
    sp: count((item) => item.speakerPlace !== undefined),
    s: count((item) => item.speaker !== undefined),
    to: count((item) => item.target !== undefined),
  };

  const text = source.split(/\r\n|\r|\n/);
  const whole = { first: /^\s*(\[\d+\] = )?\{$/, last: /^\s*\}/ };

  return {
    utf8: Buffer.from(source, 'utf8').equals(bytes),
    sameAsReference: isDeepStrictEqual(toPlain(parseLua(source).get('StoryLogDB')!), reference),
    lines,
    entries: doc.entries.length,
    items: doc.items.length,
    typesInFile: typesInFile.size,
    types: new Set(doc.items.map((item) => item.type)).size,
    charactersInFile: characters.size,
    owners: new Set(doc.logs.map((log) => log.owner)).size,
    misplaced: doc.entries.filter(
      (entry) => !whole.first.test(text[entry.startLine - 1]!) || !whole.last.test(text[entry.endLine - 1]!),
    ).length,
    undated: count((item) => item.time === null),
    dangling,
    dropped: REFERENCES.reduce((sum, key) => sum + Math.abs(inFile[key] - inDocument[key]), 0),
    unchanged: exportLua(doc, computeSelection(doc, NO_FILTERS, new Set()).states) === source,
    badCuts: cuts(doc).filter((cut) => !survives(doc, cut)).length,
  };
}

interface Cut {
  filters: Filters;
  removed: string[];
}

/** The cuts that the real Elephant file gets, and by place, which only StoryLog has. */
function cuts(doc: LogDocument): Cut[] {
  const times = doc.items.flatMap((item) => item.time ?? []);
  const channel = doc.logs[0]?.channel;
  const place = doc.places?.flatMap(placeKeys)[0];
  return [
    { filters: NO_FILTERS, removed: doc.items.filter((_, index) => index % 3 === 0).map((item) => item.id) },
    ...(channel ? [{ filters: { ...NO_FILTERS, channels: [channel] }, removed: [] }] : []),
    ...(times.length
      ? [{ filters: { ...NO_FILTERS, types: RP_TYPES, from: times[Math.floor(times.length / 2)]! }, removed: [] }]
      : []),
    ...(place ? [{ filters: { ...NO_FILTERS, places: [place] }, removed: [] }] : []),
  ];
}

function survives(doc: LogDocument, { filters, removed }: Cut): boolean {
  try {
    const { messages, states } = computeSelection(doc, filters, new Set(removed));
    const lua = exportLua(doc, states);
    if (!isDeepStrictEqual(toPlain(parseLua(lua).get('StoryLogDB')!), referenceParse(lua))) return false;

    const back = parseLog(lua);
    const kept = back.items.filter((item) => item.kind === 'message');
    // By content, as cutting one of two identical lines renumbers the other.
    return isDeepStrictEqual(facts(kept, back), facts(messages, doc));
  } catch {
    return false;
  }
}

function facts(items: LogItem[], { places = [] }: LogDocument): string[] {
  const at = (index: number | undefined) => (index === undefined ? null : places[index]);
  return items
    .map((item) =>
      JSON.stringify([
        item.owner,
        item.time,
        item.type,
        item.raw,
        item.sender,
        item.rpName ?? null,
        at(item.place),
        at(item.speakerPlace),
      ]),
    )
    .sort();
}
