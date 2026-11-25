/** What the parsers of both file formats share. */
import { getField, isTable, type LuaField, type LuaTable } from './lua';

export class NotLogFileError extends Error {
  constructor() {
    super('This is not an Elephant or StoryLog file (no ElephantDB or StoryLogDB table with chat logs).');
    this.name = 'NotLogFileError';
  }
}

/** The fixed IDs of Elephant's built-in logs (`default_logs` in its Core.lua). StoryLog files use them too. */
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

export function fillSender(type: string, text: string, sender: string | undefined): string {
  return sender && SENDER_IN_TEXT.has(type) ? text.replace(/%(?:1\$)?s/g, () => sender) : text;
}

export function child(table: LuaTable, key: LuaField['key']): LuaTable | undefined {
  const value = getField(table, key)?.value;
  return isTable(value) ? value : undefined;
}

export function stringField(table: LuaTable, key: string): string | undefined {
  const value = getField(table, key)?.value;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

export function numberField(table: LuaTable, key: string): number | undefined {
  const value = getField(table, key)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function booleanField(table: LuaTable, key: string): boolean | undefined {
  const value = getField(table, key)?.value;
  return typeof value === 'boolean' ? value : undefined;
}

/** A list's tables in Lua's order, whether or not they are written as `[n] =`. */
export function listTables(list: LuaTable | undefined): (LuaField & { value: LuaTable })[] {
  return (list?.fields ?? [])
    .filter((field): field is LuaField & { value: LuaTable } => isTable(field.value))
    .sort((a, b) => Number(a.key) - Number(b.key));
}

/** Maps an offset to a 1-based line number, counting CRLF, LF and CR as one break each. */
export function lineLookup(source: string): (offset: number) => number {
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
