import { memo, useMemo, useState } from 'react';
import {
  fillColours,
  fitView,
  gridLines,
  groupDots,
  mapChoices,
  mapDots,
  placeLabels,
  speakerTally,
  type Dot,
} from '../../shared/mapData';
import { placeDetails, placeName } from '../../shared/places';
import type { LogItem, Place } from '../../shared/types';
import { clock, dayTitle } from '../time';

/** The drawing's own units. Zone maps are three wide to two high. */
const WIDTH = 1200;
const HEIGHT = 800;
/** Three is as many as stay apart for colour-blind readers when any two dots can touch. */
const SERIES = ['#3987e5', '#d95926', '#199e70'];
const OTHER = '#898781';
const TOOLTIP_LINES = 3;
/** Between the middles of two dots on one spot. */
const MARK_GAP = 28;

const WHOLE = { left: 0, top: 0, size: 1 };

interface Props {
  items: LogItem[];
  places: Place[];
  /** Shows a line in the chat. */
  onJump: (id: string) => void;
}

/** Memoised, as it can be thousands of shapes and its owner renders on every keystroke. */
export const MapView = memo(function MapView({ items, places, onJump }: Props) {
  const maps = useMemo(() => mapChoices(items, places), [items, places]);
  const [picked, setPicked] = useState<number | null>(null);
  // A filter or a scene can take every line off the picked map. Then show the busiest one.
  const map = picked !== null && maps.some((choice) => choice.map === picked) ? picked : (maps[0]?.map ?? null);

  const spots = useMemo(() => (map === null ? [] : mapDots(items, places, map)), [items, places, map]);
  const people = useMemo(() => speakerTally(spots), [spots]);
  // Colours follow the person: a filter never repaints someone who is on the map.
  const [coloured, setColoured] = useState<readonly (string | null)[]>(() => SERIES.map(() => null));
  const filled = fillColours(coloured, people);
  if (filled !== coloured) setColoured(filled);

  const [whole, setWhole] = useState(false);
  const [hovered, setHovered] = useState<Dot | null>(null);
  const [openKey, setOpenKey] = useState('');
  const [withoutImage, setWithoutImage] = useState<ReadonlySet<number>>(new Set());

  const view = useMemo(() => (whole ? WHOLE : fitView(spots)), [whole, spots]);
  const dots = useMemo(() => groupDots(spots, view), [spots, view]);
  const px = (x: number) => ((x - view.left) / view.size) * WIDTH;
  const py = (y: number) => ((y - view.top) / view.size) * HEIGHT;
  /** Several speakers on one spot are fanned out around it. */
  const centre = (dot: Dot): [number, number] => {
    if (dot.of === 1) return [px(dot.x), py(dot.y)];
    const angle = (dot.nth / dot.of) * 2 * Math.PI - Math.PI / 2;
    // Wide enough that neighbours in the ring don't cover each other.
    const radius = Math.max(16, MARK_GAP / 2 / Math.sin(Math.PI / dot.of));
    return [px(dot.x) + radius * Math.cos(angle), py(dot.y) + radius * Math.sin(angle)];
  };

  const colourOf = (speaker: string) => {
    const slot = coloured.indexOf(speaker);
    return slot < 0 ? OTHER : SERIES[slot]!;
  };

  const toggleColour = (key: string) =>
    setColoured((current) => {
      const next = [...current];
      let slot = next.indexOf(key);
      if (slot >= 0) {
        next[slot] = null;
        return next;
      }
      slot = next.indexOf(null);
      if (slot < 0) {
        // Take the colour from whoever has the fewest lines here.
        const lines = next.map((other) => people.find((person) => person.key === other)?.lines ?? 0);
        slot = lines.indexOf(Math.min(...lines));
      }
      next[slot] = key;
      return next;
    });

  const open = dots.find((dot) => dot.key === openKey);
  const tip = hovered && dots.includes(hovered) ? hovered : null;
  const select = (dot: Dot) => {
    if (dot.items.length === 1) {
      // The map is hidden next, so no mouseleave will take the tooltip away.
      setHovered(null);
      onJump(dot.items[0]!.id);
    } else {
      setOpenKey(dot.key);
    }
  };

  const image = map !== null && !withoutImage.has(map);
  const grid = gridLines(view);

  return (
    <div className="map-view">
      <div className="legend">
        <label className="inline">
          Map
          <select
            aria-label="Map"
            value={map ?? ''}
            disabled={map === null}
            onChange={(event) => {
              setPicked(Number(event.target.value));
              setOpenKey('');
            }}
          >
            {map === null && <option value="">None</option>}
            {maps.map((choice) => (
              <option key={choice.map} value={choice.map}>
                {choice.name} (map {choice.map}) · {choice.lines}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={whole} onChange={(event) => setWhole(event.target.checked)} />
          Whole map
        </label>
        <span className="key-exact">where they stood</span>
        <span className="key-heard">where you stood when you heard them</span>
      </div>

      <div className="map-body">
        <div className="map-stage">
          <div className="map-canvas">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label="Where the selected lines were spoken">
              {image && (
                <image
                  key={map}
                  href={`/api/maps/${map}`}
                  x={px(0)}
                  y={py(0)}
                  width={WIDTH / view.size}
                  height={HEIGHT / view.size}
                  preserveAspectRatio="none"
                  onError={() => setWithoutImage((current) => new Set(current).add(map))}
                />
              )}
              <g className="map-grid">
                {grid.x.map(({ at, label }) => (
                  <g key={`x${label}`}>
                    <line x1={px(at)} x2={px(at)} y1={0} y2={HEIGHT} />
                    <text x={px(at) + 5} y={HEIGHT - 8}>
                      {label}
                    </text>
                  </g>
                ))}
                {grid.y.map(({ at, label }) => (
                  <g key={`y${label}`}>
                    <line x1={0} x2={WIDTH} y1={py(at)} y2={py(at)} />
                    <text x={6} y={py(at) - 6}>
                      {label}
                    </text>
                  </g>
                ))}
              </g>

              {/* All the generous targets go under all the dots, so none hides a neighbour. */}
              {dots.map((dot) => {
                const [cx, cy] = centre(dot);
                return (
                  <circle
                    key={dot.key}
                    className={dot.key === openKey ? 'hit open' : 'hit'}
                    cx={cx}
                    cy={cy}
                    r={24}
                    aria-hidden="true"
                    onClick={() => select(dot)}
                    onMouseEnter={() => setHovered(dot)}
                    onMouseLeave={() => setHovered(null)}
                  />
                );
              })}
              {dots.map((dot) => {
                const [cx, cy] = centre(dot);
                const colour = colourOf(dot.speaker);
                return (
                  <g
                    key={dot.key}
                    className="dot"
                    data-ids={dot.items.map((item) => item.id).join(' ')}
                    role="button"
                    tabIndex={0}
                    aria-label={`${dot.name}, ${dot.items.length} ${dot.items.length === 1 ? 'line' : 'lines'}`}
                    onClick={() => select(dot)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      select(dot);
                    }}
                    onMouseEnter={() => setHovered(dot)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(dot)}
                    onBlur={() => setHovered(null)}
                  >
                    <circle className="focus-ring" cx={cx} cy={cy} r={15} />
                    <circle className="surface" cx={cx} cy={cy} r={12} />
                    {dot.exact ? (
                      <circle cx={cx} cy={cy} r={9} fill={colour} />
                    ) : (
                      <circle cx={cx} cy={cy} r={7.5} fill="none" stroke={colour} strokeWidth={3.5} />
                    )}
                  </g>
                );
              })}

              <g className="map-labels">
                {placeLabels(dots, places, view, WIDTH, HEIGHT).map((label) => (
                  <text key={label.text} x={label.x} y={label.y}>
                    {label.text}
                  </text>
                ))}
              </g>
            </svg>

            {tip && <Tooltip dot={tip} at={centre(tip)} places={places} />}
            {dots.length === 0 && (
              <p className="map-empty">
                {map === null
                  ? 'None of the selected lines have coordinates. The game gives none inside dungeons, raids and battlegrounds.'
                  : 'None of the selected lines are on this map.'}
              </p>
            )}
          </div>
        </div>

        <aside className="map-side" aria-label="Speakers on the map">
          <h3>Speakers</h3>
          <p className="hint">Click to colour up to three. The rest are grey.</p>
          <ul>
            {people.map((person) => (
              <li key={person.key}>
                <button
                  className="map-person"
                  aria-pressed={coloured.includes(person.key)}
                  onClick={() => toggleColour(person.key)}
                >
                  <i style={{ background: colourOf(person.key) }} />
                  <span className="choice">{person.name}</span>
                  <span className="count">{person.lines}</span>
                </button>
              </li>
            ))}
          </ul>

          {open && (
            <>
              <h3>
                {open.name}, {open.items.length} lines here
              </h3>
              <ol className="map-lines">
                {open.items.map((item) => (
                  <li key={item.id}>
                    <button onClick={() => onJump(item.id)}>
                      <span className="count">{clock.time(item.at)}</span> {item.text}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </aside>
      </div>
    </div>
  );
});

function Tooltip({ dot, at: [x, y], places }: { dot: Dot; at: [number, number]; places: Place[] }) {
  const right = x > WIDTH / 2;
  const below = y > HEIGHT / 2;
  const style = {
    [right ? 'right' : 'left']: `calc(${((right ? WIDTH - x : x) / WIDTH) * 100}% + 18px)`,
    [below ? 'bottom' : 'top']: `${((below ? HEIGHT - y : y) / HEIGHT) * 100}%`,
  };
  const first = dot.items[0]!;
  const place = places[dot.place]!;

  return (
    <div className="map-tip" role="tooltip" style={style}>
      <strong>{dot.name}</strong>
      <span className="count">
        {placeName(place)} · {placeDetails(place)}
      </span>
      <span className="count">{dayTitle(clock.day(first.at))}</span>
      {dot.items.slice(0, TOOLTIP_LINES).map((item) => (
        <p key={item.id}>
          <span className="count">{clock.time(item.at)}</span> {item.text}
        </p>
      ))}
      <span className="count">
        {dot.items.length > TOOLTIP_LINES && `${dot.items.length - TOOLTIP_LINES} more. `}
        {dot.items.length === 1 ? 'Click to show it in the chat.' : 'Click to list them.'}
      </span>
    </div>
  );
}
