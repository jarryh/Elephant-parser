import { hash } from './hash';
import { getField, isTable, parseLua, type LuaField, type LuaTable } from './lua';
import { stripMarkup } from './markup';
import type { Entry, ItemKind, LogDocument, LogInfo, LogItem } from './types';

/** The fixed IDs of Elephant's built-in logs (`default_logs` in its Core.lua). */
export const DEFAULT_LOG_NAMES: ReadonlyMap<number, string> = new Map([
  [1, 'Whisper'],
  [2, 'Raid'],
  [3, 'Party'],
  [4, 'Say'],
  [5, 'Yell'],
  [6, 'Officer'],
  [7, 'Guild'],
  [8, 'Loot'],
  [9, 'System'],
  [10, 'Achievement'],
  [11, 'Instance'],
  [12, 'Pet battle'],
]);

/** For these types the text is a format string and the sender fills the `%s`. */
const SENDER_IN_TEXT = new Set(['MONSTER_EMOTE', 'RAID_BOSS_EMOTE', 'ACHIEVEMENT', 'GUILD_ACHIEVEMENT']);

export class NotElephantFileError extends Error {
  constructor() {
    super('This is not an Elephant file (no ElephantDB table with chat logs).');
    this.name = 'NotElephantFileError';
  }
}

export function parseElephant(source: string): LogDocument {
  const db = parseLua(source).get('ElephantDB');
  if (!isTable(db)) throw new NotElephantFileError();
  const scopes = (['char', 'factionrealm'] as const)
    .map((name) => ({ name, table: child(db, name) }))
    .filter((scope) => scope.table);
  if (!scopes.length) throw new NotElephantFileError();

  const logs: LogInfo[] = [];
  const entries: Entry[] = [];
  const items = new Map<string, LogItem>();
  const lineAt = lineLookup(source);

  for (const { name: scope, table } of scopes) {
    for (const ownerField of table!.fields) {
      if (!isTable(ownerField.value)) continue;
      const owner = scope === 'char' ? String(ownerField.key) : `${ownerField.key} (shared)`;

      for (const logField of child(ownerField.value, 'logs')?.fields ?? []) {
        if (!isTable(logField.value)) continue;
        const list = child(logField.value, 'logs');
        if (!list) continue;

        const log = describeLog(owner, logField.key, logField.value);
        const logIndex = logs.push(log) - 1;

        for (const { id, field, item } of readEntries(log, list)) {
          const entry: Entry = {
            id,
            log: logIndex,
            start: field.start,
            end: field.end,
            startLine: lineAt(field.start),
            endLine: lineAt(field.end - 1),
          };
          if (field.explicitKey) entry.valueStart = field.valueStart;
          entries.push(entry);

          const known = items.get(id);
          if (!known) items.set(id, item);
          else if (!known.channels.includes(log.channel)) known.channels.push(log.channel);
        }
      }
    }
  }

  const all = [...items.values()];
  inferEmoteSenders(all);
  // Array sort is stable, so messages within the same second keep their file order.
  all.sort((a, b) => a.at - b.at);
  entries.sort((a, b) => a.start - b.start);
  return { source, logs, entries, items: all };
}

function child(table: LuaTable, key: LuaField['key']): LuaTable | undefined {
  const value = getField(table, key)?.value;
  return isTable(value) ? value : undefined;
}

function stringField(table: LuaTable, key: string): string | undefined {
  const value = getField(table, key)?.value;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function describeLog(owner: string, key: LuaField['key'], table: LuaTable): LogInfo {
  const numbered = typeof key === 'number';
  const builtIn = numbered ? DEFAULT_LOG_NAMES.get(key) : undefined;
  const log: LogInfo = {
    owner,
    channel: numbered ? `#${key}` : String(key),
    label: builtIn ?? stringField(table, 'name') ?? (numbered ? `Log ${key}` : String(key)),
    hasMessage: false,
  };
  const hasMessage = getField(table, 'hasMessage');
  if (hasMessage) {
    log.hasMessage = hasMessage.value === true;
    log.hasMessageSpan = [hasMessage.valueStart, hasMessage.valueEnd];
  }
  return log;
}

/**
 * Reads one log and gives every entry an ID that survives the file changing.
 *
 * Elephant appends at the bottom and deletes from the top, so positions are useless.
 * - A message is identified by its content. Copies of it in other logs get the same ID,
 *   and identical lines within one log are told apart by their occurrence number.
 * - A marker is identified by its log and text (which contains the date).
 * - A spacer is identified by its log and the entry before it.
 */
function readEntries(log: LogInfo, list: LuaTable): { id: string; field: LuaField; item: LogItem }[] {
  const fields = list.fields
    .filter((field): field is LuaField & { value: LuaTable } => isTable(field.value))
    .sort((a, b) => Number(a.key) - Number(b.key));
  const times = fields.map((field) => {
    const time = getField(field.value, 'time')?.value;
    return typeof time === 'number' && Number.isFinite(time) ? time : null;
  });

  // A marker introduces the session after it, so it takes the next message's time.
  const nextTime: (number | null)[] = new Array(fields.length).fill(null);
  let next: number | null = null;
  for (let i = fields.length - 1; i >= 0; i--) {
    next = times[i] ?? next;
    nextTime[i] = next;
  }

  const occurrences = new Map<string, number>();
  let previousId = '';
  let previousTime: number | null = null;

  return fields.map((field, i) => {
    const get = (key: string) => stringField(field.value, key);
    const time = times[i] ?? null;
    const type = get('type') ?? '';
    const arg1 = get('arg1') ?? '';
    const arg2 = get('arg2');
    const battleTag = get('battleTag');
    const channelName = get('arg9');
    const prat = get('prat');
    const ellipsis = getField(field.value, 'ellipsis')?.value === true;

    const kind: ItemKind = time !== null ? 'message' : !type && !arg1.trim() ? 'spacer' : 'marker';
    const identity =
      kind === 'message'
        ? ['m', log.owner, time, type, arg1, arg2, channelName, battleTag, prat, ellipsis]
        : kind === 'marker'
          ? ['k', log.owner, log.channel, type, arg1]
          : ['s', log.owner, log.channel, previousId];
    const base = JSON.stringify(identity);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    const id = hash(`${base}#${occurrence}`);

    let raw = prat ?? (ellipsis ? '(...)' : arg1);
    if (!prat && arg2 && SENDER_IN_TEXT.has(type)) raw = raw.replace(/%(?:1\$)?s/g, () => arg2);

    let sender: string | null = arg2 ? stripMarkup(arg2) : null;
    if (type === 'BN_WHISPER' || type === 'BN_WHISPER_INFORM') sender = battleTag ?? 'Battle.net friend';
    if (prat) sender = null;

    const item: LogItem = {
      id,
      kind,
      owner: log.owner,
      channels: [log.channel],
      time,
      at: time ?? (kind === 'marker' ? (nextTime[i] ?? previousTime) : previousTime) ?? 0,
      type,
      raw,
      text: stripMarkup(raw),
      sender,
    };
    const color = get('clColor');
    if (color && /^[0-9a-fA-F]{8}$/.test(color)) item.color = `#${color.slice(2)}`;
    const flag = get('arg6');
    if (flag) item.flag = flag;
    if (channelName) item.channelName = channelName;

    previousId = id;
    if (time !== null) previousTime = time;
    return { id, field, item };
  });
}

/** Built-in emotes ("Ann waves at you.") store no sender, so match known names. */
function inferEmoteSenders(items: LogItem[]): void {
  const names = new Set<string>();
  for (const item of items) {
    names.add(item.owner);
    if (item.sender) names.add(item.sender);
  }
  const longestFirst = [...names].sort((a, b) => b.length - a.length);

  for (const item of items) {
    if (item.type !== 'TEXT_EMOTE' || item.sender) continue;
    if (/^You(?:r)?\b/.test(item.text)) {
      item.sender = item.owner;
    } else {
      item.sender =
        longestFirst.find(
          (name) => item.text.startsWith(name) && /^[\s'’,]/.test(item.text.slice(name.length)),
        ) ?? null;
    }
  }
}

/** Maps an offset to a 1-based line number, counting CRLF, LF and CR as one break each. */
function lineLookup(source: string): (offset: number) => number {
  const starts = [0];
  for (const found of source.matchAll(/\r\n|\r|\n/g)) starts.push(found.index + found[0].length);

  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}
