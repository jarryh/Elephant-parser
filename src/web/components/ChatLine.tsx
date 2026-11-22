import { memo } from 'react';
import { lineTag, speaker, typeColor } from '../../shared/format';
import { parseMarkup } from '../../shared/markup';
import type { LogItem } from '../../shared/types';
import { clock } from '../time';

interface Props {
  item: LogItem;
  showOwner: boolean;
}

export const ChatLine = memo(function ChatLine({ item, showOwner }: Props) {
  const marker = item.kind === 'marker';
  const who = speaker(item);

  return (
    <div
      className={marker ? 'line marker' : 'line'}
      data-id={item.id}
      style={{ color: marker ? undefined : typeColor(item.type) }}
    >
      <span className="time" title={item.time ? new Date(item.time * 1000).toLocaleString() : undefined}>
        {item.time === null ? '' : clock.time(item.time)}
      </span>
      {showOwner && (
        <span className="owner" title={`Logged by ${item.owner}`}>
          {item.owner.split(' ')[0]}
        </span>
      )}
      <span className="body">
        {!marker && <span className="tag">[{lineTag(item)}] </span>}
        {item.flag && <span className="flag">&lt;{item.flag}&gt; </span>}
        {who && (
          <>
            {who.before}
            <span className="sender" style={{ color: item.color }}>
              {who.name}
            </span>
            {who.after}
          </>
        )}
        {parseMarkup(item.raw).map((segment, index) => (
          <span key={index} style={{ color: segment.color }}>
            {segment.text}
          </span>
        ))}
      </span>
    </div>
  );
});
