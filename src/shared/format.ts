import type { LogItem } from './types';

const TYPES = new Map<string, [label: string, color: string]>([
  ['SAY', ['Say', '#f4f4f4']],
  ['YELL', ['Yell', '#ff5c5c']],
  ['EMOTE', ['Emote', '#ff9a56']],
  ['TEXT_EMOTE', ['Built-in emote', '#ff9a56']],
  ['WHISPER', ['Whisper', '#ff8cff']],
  ['WHISPER_INFORM', ['Whisper sent', '#ff8cff']],
  ['BN_WHISPER', ['Battle.net whisper', '#35e0f5']],
  ['BN_WHISPER_INFORM', ['Battle.net whisper sent', '#35e0f5']],
  ['PARTY', ['Party', '#aab4ff']],
  ['PARTY_LEADER', ['Party leader', '#86c8ff']],
  ['RAID', ['Raid', '#ff8a2a']],
  ['RAID_LEADER', ['Raid leader', '#ff6a30']],
  ['RAID_WARNING', ['Raid warning', '#ff5a1f']],
  ['INSTANCE_CHAT', ['Instance', '#ff8a2a']],
  ['INSTANCE_CHAT_LEADER', ['Instance leader', '#ff6a30']],
  ['GUILD', ['Guild', '#4df05a']],
  ['OFFICER', ['Officer', '#43c043']],
  ['CHANNEL', ['Channel', '#f5bcbc']],
  ['MONSTER_SAY', ['NPC say', '#fff3a0']],
  ['MONSTER_YELL', ['NPC yell', '#ff6b5b']],
  ['MONSTER_EMOTE', ['NPC emote', '#ff9a56']],
  ['MONSTER_WHISPER', ['NPC whisper', '#f0b0ec']],
  ['RAID_BOSS_EMOTE', ['Boss emote', '#ffd633']],
  ['SYSTEM', ['System', '#e8d44d']],
  ['BG_SYSTEM_NEUTRAL', ['Battleground', '#f0a040']],
  ['ROLL', ['Dice roll', '#e8d44d']],
  ['LOOT', ['Loot', '#38b878']],
  ['MONEY', ['Money', '#c8c860']],
  ['SKILL', ['Skill', '#8f8fff']],
  ['QUEST_ACCEPTED', ['Quest accepted', '#ffd100']],
  ['QUEST_TURNED_IN', ['Quest completed', '#ffd100']],
  ['GROUP', ['Group', '#aab4ff']],
  ['ACHIEVEMENT', ['Achievement', '#f0e040']],
  ['GUILD_ACHIEVEMENT', ['Guild achievement', '#4df05a']],
]);

export function typeLabel(type: string): string {
  const known = TYPES.get(type)?.[0];
  if (known) return known;
  const words = type.toLowerCase().replaceAll('_', ' ');
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Note';
}

export function typeColor(type: string): string {
  return TYPES.get(type)?.[1] ?? '#c4c4cc';
}

/** The label in front of a line. */
export function lineTag(item: LogItem): string {
  return item.channelName ?? typeLabel(item.type);
}

/**
 * How the sender is written in front of the text.
 * Null when the text already names them, or there is nobody to name.
 */
export function speaker(item: LogItem): { before: string; name: string; after: string } | null {
  if (!item.sender) return null;
  const name = item.rpName ?? item.sender;
  switch (item.type) {
    case 'TEXT_EMOTE':
    case 'ROLL':
    case 'MONSTER_EMOTE':
    case 'RAID_BOSS_EMOTE':
    case 'ACHIEVEMENT':
    case 'GUILD_ACHIEVEMENT':
    case 'QUEST_ACCEPTED':
    case 'QUEST_TURNED_IN':
      return null;
    case 'EMOTE':
      return { before: '', name, after: ' ' };
    case 'MONSTER_SAY':
      return { before: '', name, after: ' says: ' };
    case 'MONSTER_YELL':
      return { before: '', name, after: ' yells: ' };
    case 'WHISPER':
    case 'BN_WHISPER':
    case 'MONSTER_WHISPER':
      return { before: '', name, after: ' whispers: ' };
    case 'WHISPER_INFORM':
    case 'BN_WHISPER_INFORM':
      return { before: 'To ', name, after: ': ' };
    default:
      return { before: '', name, after: ': ' };
  }
}

export function isNpc(item: LogItem): boolean {
  return /^(?:MONSTER_|RAID_BOSS_)/.test(item.type);
}

/** A quest that the recorder accepted or handed in. */
export function isQuest(item: LogItem): boolean {
  return item.type === 'QUEST_ACCEPTED' || item.type === 'QUEST_TURNED_IN';
}

export interface Clock {
  /** YYYY-MM-DD */
  day(time: number): string;
  /** HH:MM */
  time(time: number): string;
}

/** Formats Unix seconds in the given timezone, or the local one if none is given. */
export function createClock(timeZone?: string): Clock {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const cache = new Map<number, { day: string; time: string }>();

  const at = (time: number) => {
    const minute = Math.floor(time / 60);
    let value = cache.get(minute);
    if (!value) {
      const parts = new Map(format.formatToParts(minute * 60_000).map((part) => [part.type, part.value]));
      value = {
        day: `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`,
        time: `${parts.get('hour')}:${parts.get('minute')}`,
      };
      cache.set(minute, value);
    }
    return value;
  };

  return { day: (time) => at(time).day, time: (time) => at(time).time };
}
