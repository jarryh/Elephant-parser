import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LogItem } from '../../shared/types';
import { clock, dayTitle } from '../time';
import { ChatLine } from './ChatLine';

type Row = { key: string; day: string } | { key: string; item: LogItem };

interface Props {
  items: LogItem[];
}

export function ChatView({ items }: Props) {
  const scroller = useRef<HTMLDivElement>(null);

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
      {items.length === 0 && <p className="nothing">Nothing matches these filters.</p>}
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
                <ChatLine item={row.item} showOwner={severalOwners} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
