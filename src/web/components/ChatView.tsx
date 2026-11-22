import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LogItem } from '../../shared/types';
import { clock, dayTitle } from '../time';
import { useRangeToggle } from '../useRangeToggle';
import { ChatLine } from './ChatLine';
import type { MenuTarget } from './LineMenu';

type Row = { key: string; day: string } | { key: string; item: LogItem };

interface Props {
  items: LogItem[];
  /** Includes hidden removed items, so shift-click still finds its starting point. */
  order: LogItem[];
  removed: ReadonlySet<string>;
  setRemoved: (ids: string[], remove: boolean) => void;
  onMenu: (target: MenuTarget) => void;
}

export function ChatView({ items, order, removed, setRemoved, onMenu }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => order.map((item) => item.id), [order]);
  const toggle = useRangeToggle(keys, (id) => id, removed, setRemoved);

  const { rows, severalOwners } = useMemo(() => {
    const rows: Row[] = [];
    let lastDay = '';
    for (const item of items) {
      const day = clock.day(item.at);
      if (day !== lastDay) {
        rows.push({ key: `day:${day}`, day });
        lastDay = day;
      }
      rows.push({ key: item.id, item });
    }
    return { rows, severalOwners: items.some((item) => item.owner !== items[0]!.owner) };
  }, [items]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 26,
    getItemKey: (index) => rows[index]!.key,
    overscan: 14,
  });

  return (
    <div className="chat" ref={scroller}>
      {items.length === 0 && <p className="nothing">Nothing matches.</p>}
      <div className="chat-inner" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtual) => {
          const row = rows[virtual.index]!;
          return (
            <div
              key={virtual.key}
              ref={virtualizer.measureElement}
              data-index={virtual.index}
              className="chat-row"
              style={{ transform: `translateY(${virtual.start}px)` }}
            >
              {'day' in row ? (
                <div className="day">{dayTitle(row.day)}</div>
              ) : (
                <ChatLine
                  item={row.item}
                  showOwner={severalOwners}
                  removed={removed.has(row.item.id)}
                  onToggle={toggle}
                  onMenu={onMenu}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
