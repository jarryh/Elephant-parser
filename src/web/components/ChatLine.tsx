import { memo, type MouseEvent } from 'react';
import { isEvent } from '../../shared/events';
import { isQuest, lineTag, speaker, typeColor } from '../../shared/format';
import { parseMarkup } from '../../shared/markup';
import { placeDetails, placeName } from '../../shared/places';
import type { LogItem, Place } from '../../shared/types';
import { linkUrl, type Game } from '../../shared/wowhead';
import { clock } from '../time';
import type { MenuTarget } from './LineMenu';

interface Props {
  item: LogItem;
  place: Place | undefined;
  game: Game;
  showOwner: boolean;
  removed: boolean;
  onToggle: (id: string, shift: boolean) => void;
  onMenu: (target: MenuTarget) => void;
}

export const ChatLine = memo(function ChatLine({ item, place, game, showOwner, removed, onToggle, onMenu }: Props) {
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

  const when = item.time ? new Date(item.time * 1000).toLocaleString() : '';
  const where = place ? `${placeName(place)}\n${placeDetails(place)}` : '';

  return (
    <div
      className={['line', marker && 'marker', item.type === 'NOTE' && 'note', item.type === 'GROUP' && 'group-change', removed && 'removed']
        .filter(Boolean)
        .join(' ')}
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
      <span className="time" title={[when, where].filter(Boolean).join('\n') || undefined}>
        {item.time === null ? '' : clock.time(item.time)}
      </span>
      {showOwner && (
        <span className="owner" title={`Logged by ${item.owner}`}>
          {item.owner.split(' ')[0]}
        </span>
      )}
      <span className="body">
        {!marker && <span className="tag">[{lineTag(item)}] </span>}
        {item.language && <span className="tag">[{item.language}] </span>}
        {item.ooc && (
          <span className="flag" title="Total RP 3 said that they were out of character">
            &lt;OOC&gt;{' '}
          </span>
        )}
        {item.flag && <span className="flag">&lt;{item.flag}&gt; </span>}
        {who && (
          <>
            {who.before}
            <button
              className="sender"
              style={{ color: item.color }}
              title={item.rpName ? `Character: ${item.sender}` : undefined}
              onClick={openMenu}
            >
              {who.name}
            </button>
            {who.after}
          </>
        )}
        {parseMarkup(item.raw).map((segment, index) =>
          segment.link ? (
            <a
              key={index}
              className="game-link"
              style={{ color: segment.color }}
              href={linkUrl(game, segment.link)}
              target="_blank"
              rel="noreferrer noopener"
              title="Opens Wowhead"
              // Neither removes the line nor replaces the browser's menu for links.
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.stopPropagation()}
            >
              {segment.text}
            </a>
          ) : (
            <span key={index} style={{ color: segment.color }}>
              {segment.text}
            </span>
          ),
        )}
        {/* A quest or an event names whoever took part in the text. */}
        {item.target && !isQuest(item) && !isEvent(item) && (
          <span className="target" title={item.self ? 'Your target when you said it' : 'Their target when they said it'}>
            {' '}
            → {item.target}
          </span>
        )}
        {item.detail && (
          <span className="detail" title={item.detail}>
            {item.detail}
          </span>
        )}
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
