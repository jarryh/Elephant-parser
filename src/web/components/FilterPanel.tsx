import { useMemo } from 'react';
import {
  channelLabels,
  compareChannels,
  computeFacets,
  NO_FILTERS,
  RP_TYPES,
  type Filters,
} from '../../shared/filter';
import { typeColor, typeLabel } from '../../shared/format';
import type { LogDocument } from '../../shared/types';
import { clock, dayRange, dayTitle, fromInput, toInput } from '../time';
import { CheckList, type Choice } from './CheckList';

interface Props {
  doc: LogDocument;
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** Removes a channel or sender within the chosen characters and period. */
  onRemove: (group: Partial<Filters>, label: string) => void;
}

export function FilterPanel({ doc, filters, onChange, onRemove }: Props) {
  const { owners, from, to } = filters;
  const facets = useMemo(() => computeFacets(doc, { owners, from, to }, clock.day), [doc, owners, from, to]);
  const labels = useMemo(() => channelLabels(doc), [doc]);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  /** Rows with a count, plus ticked ones that currently have none. */
  const choices = (counts: Map<string, number>, selected: string[], label = (value: string) => value): Choice[] =>
    [...new Set([...counts.keys(), ...selected])].map((value) => ({
      value,
      label: label(value),
      count: counts.get(value) ?? 0,
    }));

  const channelChoices = choices(facets.channels, filters.channels, (value) => labels.get(value) ?? value).sort(
    (a, b) => compareChannels(a.value, b.value),
  );
  const typeChoices = choices(facets.types, filters.types, typeLabel)
    .map((choice) => ({ ...choice, color: typeColor(choice.value) }))
    .sort((a, b) => b.count - a.count);
  const senderChoices = choices(facets.senders, filters.senders).sort((a, b) => b.count - a.count);

  const scope = owners.length || from !== null || to !== null ? ' (chosen characters and period)' : '';
  const days = [...facets.days].sort(([a], [b]) => b.localeCompare(a));
  const selectedDay =
    days.find(([day]) => {
      const range = dayRange(day);
      return range.from === from && range.to === to;
    })?.[0] ?? '';

  return (
    <aside className="filters" aria-label="Filters">
      <div className="filters-head">
        <h2>Filters</h2>
        <button className="link" onClick={() => onChange(NO_FILTERS)}>
          Reset
        </button>
      </div>

      <input
        type="search"
        aria-label="Search text and senders"
        placeholder="Search text and senders…"
        value={filters.text}
        onChange={(event) => set({ text: event.target.value })}
      />

      <details className="group" open>
        <summary>
          <span>Period</span>
          <span className="summary-note">{from === null && to === null ? 'all time' : 'limited'}</span>
        </summary>
        <label className="field">
          Whole day
          <select
            value={selectedDay}
            onChange={(event) => set(event.target.value ? dayRange(event.target.value) : { from: null, to: null })}
          >
            <option value="">{from === null && to === null ? 'All days' : 'Custom (pick to clear)'}</option>
            {days.map(([day, count]) => (
              <option key={day} value={day}>
                {dayTitle(day)} ({count})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          From
          <input
            type="datetime-local"
            value={toInput(from)}
            onChange={(event) => set({ from: fromInput(event.target.value, 'start') })}
          />
        </label>
        <label className="field">
          To
          <input
            type="datetime-local"
            value={toInput(to)}
            onChange={(event) => set({ to: fromInput(event.target.value, 'end') })}
          />
        </label>
        {from !== null && to !== null && from > to && <p className="error">"From" is later than "To".</p>}
        {(from !== null || to !== null) && (
          <button className="link" onClick={() => set({ from: null, to: null })}>
            All time
          </button>
        )}
      </details>

      <CheckList
        title="Character"
        choices={choices(facets.owners, owners)}
        selected={owners}
        onChange={(value) => set({ owners: value })}
      />
      <CheckList
        title="Channel"
        choices={channelChoices}
        selected={filters.channels}
        onChange={(value) => set({ channels: value })}
        action={{
          label: '×',
          title: (choice) => `Remove all ${choice.count} in ${choice.label}${scope}`,
          run: (choice) => onRemove({ channels: [choice.value] }, choice.label),
        }}
      />
      <div className="preset">
        <button
          onClick={() => set({ types: RP_TYPES })}
          title="Say, yell, emotes, party, raid and NPC speech"
        >
          Roleplay types only
        </button>
      </div>
      <CheckList
        title="Message type"
        choices={typeChoices}
        selected={filters.types}
        onChange={(value) => set({ types: value })}
        open={false}
      />
      <CheckList
        title="Sender"
        choices={senderChoices}
        selected={filters.senders}
        onChange={(value) => set({ senders: value })}
        action={{
          label: '×',
          title: (choice) => `Remove all ${choice.count} from ${choice.label}${scope}`,
          run: (choice) => onRemove({ senders: [choice.value] }, choice.label),
        }}
        searchable
        open={false}
      />

      <label className="switch">
        <input
          type="checkbox"
          checked={filters.showMarkers}
          onChange={(event) => set({ showMarkers: event.target.checked })}
        />
        Show "Logging started" markers
      </label>
    </aside>
  );
}
