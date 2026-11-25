import { useState } from 'react';
import { fold } from '../../shared/filter';

export interface Choice {
  value: string;
  label: string;
  count: number;
  color?: string;
}

interface Props {
  title: string;
  choices: Choice[];
  selected: string[];
  onChange: (selected: string[]) => void;
  searchable?: boolean;
  open?: boolean;
  /** An optional button on each row. */
  action?: { label: string; title: (choice: Choice) => string; run: (choice: Choice) => void };
}

const LIMIT = 60;

export function CheckList({ title, choices, selected, onChange, searchable, open = true, action }: Props) {
  const [search, setSearch] = useState('');
  const chosen = new Set(selected);

  const needle = fold(search.trim());
  const found = needle ? choices.filter((choice) => fold(choice.label).includes(needle)) : choices;
  // Ticked rows must stay reachable, even past the limit.
  const visible = found.filter((choice, index) => index < LIMIT || chosen.has(choice.value));

  const toggle = (value: string) =>
    onChange(chosen.has(value) ? selected.filter((entry) => entry !== value) : [...selected, value]);

  return (
    <details className="group" open={open}>
      <summary>
        <span>{title}</span>
        <span className="summary-note">{selected.length ? `${selected.length} selected` : 'all'}</span>
      </summary>
      {searchable && (
        <input
          type="search"
          aria-label={`Find in ${title}`}
          placeholder="Find…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      {selected.length > 0 && (
        <button className="link" onClick={() => onChange([])}>
          Show all
        </button>
      )}
      <ul className="checklist">
        {visible.map((choice) => (
          <li key={choice.value} className={choice.count ? '' : 'empty'}>
            <label>
              <input type="checkbox" checked={chosen.has(choice.value)} onChange={() => toggle(choice.value)} />
              <span className="choice" style={{ color: choice.color }} title={choice.label}>
                {choice.label}
              </span>
              <span className="count">{choice.count}</span>
            </label>
            {action && (
              <button
                className="row-action"
                title={action.title(choice)}
                aria-label={action.title(choice)}
                disabled={!choice.count}
                onClick={() => action.run(choice)}
              >
                {action.label}
              </button>
            )}
          </li>
        ))}
      </ul>
      {found.length > visible.length && (
        <p className="hint">{found.length - visible.length} more. Use Find to narrow down.</p>
      )}
    </details>
  );
}
