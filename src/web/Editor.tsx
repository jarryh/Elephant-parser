import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import type { LoadedFile } from '../shared/api';
import { createMatcher, NO_FILTERS, type Filters } from '../shared/filter';
import { ChatView } from './components/ChatView';
import { FilterPanel } from './components/FilterPanel';

interface Props {
  loaded: LoadedFile;
  picker: ReactNode;
  loadError: string;
}

export function Editor({ loaded, picker, loadError }: Props) {
  const { document: doc, file } = loaded;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  const applied = useDeferredValue(filters);
  const shown = useMemo(() => doc.items.filter(createMatcher(applied)), [doc, applied]);
  const total = useMemo(() => doc.items.filter((item) => item.kind === 'message').length, [doc]);
  const shownMessages = useMemo(() => shown.filter((item) => item.kind === 'message').length, [shown]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Elephant parser</h1>
        {picker}
      </header>
      {loadError && (
        <p className="banner error" role="alert">
          {loadError}
        </p>
      )}
      <div className="workarea">
        <FilterPanel doc={doc} filters={filters} onChange={setFilters} />
        <main className="stage">
          <ChatView items={shown} />
        </main>
      </div>
      <footer className="statusbar">
        <span>
          <strong>{shownMessages}</strong> of {total} messages shown
        </span>
        <span>File saved by the game: {new Date(file.modified).toLocaleString()}</span>
      </footer>
    </div>
  );
}
