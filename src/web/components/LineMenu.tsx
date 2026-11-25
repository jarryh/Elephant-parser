import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Filters } from '../../shared/filter';
import type { LogItem, Speaker } from '../../shared/types';
import { npcUrl, type Game } from '../../shared/wowhead';
import { clock, dayTitle } from '../time';

export interface MenuTarget {
  item: LogItem;
  x: number;
  y: number;
}

interface Props {
  target: MenuTarget;
  messages: LogItem[];
  labels: Map<string, string>;
  speakers: readonly Speaker[] | undefined;
  game: Game;
  removed: ReadonlySet<string>;
  onClose: () => void;
  onFilter: (patch: Partial<Filters>) => void;
  onBulk: (items: LogItem[], remove: boolean, what?: string) => void;
  onShowRaw: (id: string) => void;
}

export function LineMenu({
  target,
  messages,
  labels,
  speakers,
  game,
  removed,
  onClose,
  onFilter,
  onBulk,
  onShowRaw,
}: Props) {
  const { item, x, y } = target;
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = box.current!;
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - element.offsetWidth - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - element.offsetHeight - 4)),
    });
    element.querySelector('button')?.focus({ preventScroll: true });
  }, [x, y, item]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  /** "Remove all 12 from Ann", or "Restore..." once they are all removed. */
  const groupAction = (group: LogItem[], what: string) => {
    if (!group.length) return null;
    const restore = group.every((entry) => removed.has(entry.id));
    return (
      <button role="menuitem" onClick={run(() => onBulk(group, !restore, ` ${what}`))}>
        {restore ? 'Restore' : 'Remove'} all {group.length} {what}
      </button>
    );
  };

  const { sender } = item;
  // As the chat names them. The filter itself goes by character.
  const shown = item.rpName ?? sender;
  const lookUp = npcUrl(game, item, speakers);
  return (
    <>
      {/* Takes the click that closes the menu, which would otherwise remove a line. */}
      <div
        className="menu-backdrop"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div className="menu" role="menu" ref={box} style={position}>
        <p className="menu-title">
          {dayTitle(clock.day(item.at))}, {clock.time(item.at)}
        </p>

        {sender && (
          <div className="menu-group">
            <button role="menuitem" onClick={run(() => onFilter({ senders: [sender] }))}>
              Show only {shown}
            </button>
            {groupAction(
              messages.filter((entry) => entry.sender === sender),
              `from ${shown}`,
            )}
            {lookUp && (
              <a role="menuitem" href={lookUp} target="_blank" rel="noreferrer noopener" onClick={onClose}>
                Look up on Wowhead
              </a>
            )}
          </div>
        )}

        {item.channels.map((channel) => (
          <div className="menu-group" key={channel}>
            <button role="menuitem" onClick={run(() => onFilter({ channels: [channel] }))}>
              Show only {labels.get(channel)}
            </button>
            {groupAction(
              messages.filter((entry) => entry.channels.includes(channel)),
              `in ${labels.get(channel)}`,
            )}
          </div>
        ))}

        <div className="menu-group">
          <button role="menuitem" onClick={run(() => onFilter({ from: Math.floor(item.at / 60) * 60 }))}>
            Start the period here
          </button>
          <button role="menuitem" onClick={run(() => onFilter({ to: Math.floor(item.at / 60) * 60 + 59 }))}>
            End the period here
          </button>
          <button role="menuitem" onClick={run(() => onShowRaw(item.id))}>
            Show in raw Lua
          </button>
        </div>
      </div>
    </>
  );
}
