/**
 * StoryLog's lines about what happened, as opposed to what was said: trades, travel,
 * fights, what an NPC said in a dialogue window. Each kind is one entry here, which the
 * reader, the filters, the chat and the story all go by.
 */
import type { LogItem } from './types';

export interface EventKind {
  /** The log it goes to, which the filters call a channel. */
  channel: string;
  /** That log's name. */
  log: string;
  /** In front of the line. */
  label: string;
  color: string;
  /** An NPC speaks it, so the NPC is named in front. */
  npc?: boolean;
  /** Like a whisper: left out of stories unless asked for. */
  private?: boolean;
  /** Many of these in a row are one line in a story. */
  merge?: boolean;
}

const LOGS = {
  group: ['@group', 'Group'],
  items: ['@items', 'Trades and items'],
  mail: ['@mail', 'Mail'],
  travel: ['@travel', 'Travel'],
  fights: ['@fights', 'Fights'],
  npc: ['@npc', 'NPC text'],
  actions: ['@actions', 'Actions'],
} as const;

type Extra = Pick<EventKind, 'npc' | 'private' | 'merge'>;

function kind(log: keyof typeof LOGS, label: string, color: string, extra: Extra = {}): EventKind {
  const [channel, name] = LOGS[log];
  return { channel, log: name, label, color, ...extra };
}

export const EVENTS: ReadonlyMap<string, EventKind> = new Map([
  ['INVITE', kind('group', 'Invite', '#aab4ff', { merge: true })],
  ['TRADE', kind('items', 'Trade', '#e0c060')],
  ['ITEM', kind('items', 'Item', '#38b878', { merge: true })],
  ['MAIL', kind('mail', 'Mail', '#c8a0ff', { private: true })],
  ['ZONE', kind('travel', 'Zone', '#7fc8e8')],
  ['TRAVEL', kind('travel', 'Travel', '#7fc8e8')],
  ['FIGHT', kind('fights', 'Fight', '#ff7a66', { merge: true })],
  ['ENCOUNTER', kind('fights', 'Boss fight', '#ff5a40')],
  ['DEATH', kind('fights', 'Death', '#b8b8b8')],
  ['REVIVED', kind('fights', 'Revived', '#a8e0a8')],
  ['DUEL', kind('fights', 'Duel', '#ff9a60')],
  ['LEVEL', kind('fights', 'Level up', '#f0e040')],
  ['GOSSIP', kind('npc', 'NPC text', '#fff3a0', { npc: true })],
  ['CHOICE', kind('npc', 'Choice', '#e8e0b0')],
  ['READ', kind('npc', 'Reading', '#d8c8a0')],
  ['CAST', kind('actions', 'Action', '#9fd8c8', { merge: true })],
  ['OUTFIT', kind('actions', 'Outfit', '#c8b4e8')],
]);

export function isEvent(item: Pick<LogItem, 'type'>): boolean {
  return EVENTS.has(item.type);
}

export const EVENT_TYPES = [...EVENTS.keys()];

/** For "roleplay types only" and scenes: not what is private, as whispers are not either. */
export const OPEN_EVENT_TYPES = EVENT_TYPES.filter((type) => !EVENTS.get(type)!.private);
