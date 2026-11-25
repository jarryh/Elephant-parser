import { memo, type MouseEvent } from 'react';
import { lineTag, speaker, typeColor } from '../../shared/format';
import { parseMarkup } from '../../shared/markup';
import type { LogItem } from '../../shared/types';
import { clock } from '../time';
import type { MenuTarget } from './LineMenu';

interface Props {
  item: LogItem;
  showOwner: boolean;
  removed: boolean;
  onToggle: (id: string, shift: boolean) => void;
  onMenu: (target: MenuTarget) => void;
}

export const ChatLine = memo(function ChatLine({ item, showOwner, removed, onToggle, onMenu }: Props) {
  const marker = item.kind === 'marker';
  const who = speaker(item);

  const openMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    let { clientX: x, clientY: y } = event;
    if (!x && !y) {
      // Opened with the keyboard.
      const box = event.currentTarget.getBoundingClientRect();
      x = box.left;
      y = box.bottom;
    }
    onMenu({ item, x, y });
  };

  return (
    <div
      className={['line', marker && 'marker', removed && 'removed'].filter(Boolean).join(' ')}
      data-id={item.id}
      tabIndex={0}
      style={{ color: marker ? undefined : typeColor(item.type) }}
      onMouseDown={(event) => {
        // Otherwise shift-click selects text.
        if (event.shiftKey) event.preventDefault();
      }}
      onClick={(event) => {
        // Selecting text to copy must not remove the line.
        if (!event.shiftKey && window.getSelection()?.toString()) return;
        onToggle(item.id, event.shiftKey);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onToggle(item.id, event.shiftKey);
      }}
      onContextMenu={openMenu}
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
            <button className="sender" style={{ color: item.color }} onClick={openMenu}>
              {who.name}
            </button>
            {who.after}
          </>
        )}
        {parseMarkup(item.raw).map((segment, index) => (
          <span key={index} style={{ color: segment.color }}>
            {segment.text}
          </span>
        ))}
      </span>
      <span className="line-hint" aria-hidden="true">
        {removed ? 'restore' : 'remove'}
      </span>
      <button className="more" aria-label="More actions" onClick={openMenu}>
        ⋯
      </button>
    </div>
  );
});
