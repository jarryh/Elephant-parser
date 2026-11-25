import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { placeDetails, placeName } from '../../shared/places';
import type { Scene } from '../../shared/scenes';
import type { LogItem, Place } from '../../shared/types';
import { zoneUrl, type Game } from '../../shared/wowhead';
import { clock, dayTitle } from '../time';
import { useRangeToggle } from '../useRangeToggle';
import { ChatLine } from './ChatLine';
import type { MenuTarget } from './LineMenu';
import type { Reveal } from './RawView';

type Row =
  | { key: string; day: string }
  | { key: string; scene: Scene }
  | { key: string; place: Place }
  | { key: string; item: LogItem };

const NAMES_IN_HEADER = 6;
const FLASH_MS = 2500;

interface Props {
  items: LogItem[];
  /** Includes hidden removed items, so shift-click still finds its starting point. */
  order: LogItem[];
  removed: ReadonlySet<string>;
  setRemoved: (ids: string[], remove: boolean) => void;
  onMenu: (target: MenuTarget) => void;
  scenes: Scene[];
  places: readonly Place[] | undefined;
  game: Game;
  reveal: Reveal | null;
}

export function ChatView({ items, order, removed, setRemoved, onMenu, scenes, places, game, reveal }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => order.map((item) => item.id), [order]);
  const toggle = useRangeToggle(keys, (id) => id, removed, setRemoved);
  const [flashed, setFlashed] = useState('');

  const sceneOf = useMemo(() => new Map(scenes.flatMap((scene) => scene.ids.map((id) => [id, scene]))), [scenes]);

  const { rows, severalOwners } = useMemo(() => {
    const rows: Row[] = [];
    let lastDay = '';
    const begun = new Set<Scene>();
    // Two characters' logs can interleave, so each has their own place.
    const lastPlace = new Map<string, string>();

    for (const item of items) {
      const day = clock.day(item.at);
      if (day !== lastDay) {
        rows.push({ key: `day:${day}`, day });
        lastDay = day;
        lastPlace.clear();
      }
      // At its first line on screen, which isn't always its first line.
      const scene = sceneOf.get(item.id);
      if (scene && !begun.has(scene)) {
        begun.add(scene);
        rows.push({ key: `scene:${scene.id}`, scene });
      }
      const place = item.place === undefined ? undefined : places?.[item.place];
      const name = placeName(place);
      if (place && name && lastPlace.get(item.owner) !== name) {
        lastPlace.set(item.owner, name);
        rows.push({ key: `place:${item.id}`, place });
      }
      rows.push({ key: item.id, item });
    }
    return { rows, severalOwners: items.some((item) => item.owner !== items[0]!.owner) };
  }, [items, sceneOf, places]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 26,
    getItemKey: (index) => rows[index]!.key,
    overscan: 14,
  });

  useEffect(() => {
    if (!reveal) return;
    const index = rows.findIndex((row) => 'item' in row && row.item.id === reveal.id);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: 'center' });
    setFlashed(reveal.id);
    const timer = setTimeout(() => setFlashed(''), FLASH_MS);
    return () => clearTimeout(timer);
    // Only when a line is asked for, not whenever the rows change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  const content = (row: Row) => {
    if ('day' in row) return <div className="day">{dayTitle(row.day)}</div>;
    if ('scene' in row) return <SceneHeader scene={row.scene} />;
    if ('place' in row) return <PlaceChip place={row.place} game={game} />;
    return (
      <ChatLine
        item={row.item}
        place={row.item.place === undefined ? undefined : places?.[row.item.place]}
        game={game}
        showOwner={severalOwners}
        removed={removed.has(row.item.id)}
        onToggle={toggle}
        onMenu={onMenu}
      />
    );
  };

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
              className={row.key === flashed ? 'chat-row flashed' : 'chat-row'}
              style={{ transform: `translateY(${virtual.start}px)` }}
            >
              {content(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SceneHeader({ scene }: { scene: Scene }) {
  const names = scene.participants.map((person) => person.name);
  const shown = names.slice(0, NAMES_IN_HEADER).join(', ');
  const more = names.length - NAMES_IN_HEADER;
  return (
    <div className="scene-head" title={names.join(', ')}>
      <strong>{scene.name || 'Scene'}</strong> {clock.time(scene.from)}–{clock.time(scene.to)} · {shown}
      {more > 0 && ` and ${more} more`}
    </div>
  );
}

function PlaceChip({ place, game }: { place: Place; game: Game }) {
  const url = zoneUrl(game, place);
  const title = placeDetails(place);
  return (
    <div className="place-row">
      {url ? (
        <a className="place-chip" href={url} target="_blank" rel="noreferrer noopener" title={`${title}\nOpens Wowhead`}>
          {placeName(place)}
        </a>
      ) : (
        <span className="place-chip" title={title}>
          {placeName(place)}
        </span>
      )}
    </div>
  );
}
