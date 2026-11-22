import { useCallback, useEffect, useRef, useState } from 'react';
import { createEdits, edit, redo, undo, type Edits } from '../shared/edits';
import type { Filters } from '../shared/filter';
import type { Workspace } from '../shared/workspace';
import { api } from './api';
import { Saver, type SaveStatus } from './saver';

/** The edits and filters of one file, saved automatically. */
export function useWorkspace(name: string, initial: Workspace) {
  const [edits, setEdits] = useState<Edits>(() => createEdits(initial.removed));
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [status, setStatus] = useState<SaveStatus>({ state: 'saved' });
  const [saver] = useState(() => new Saver(initial.revision, (workspace) => api.saveWorkspace(name, workspace)));

  const saved = useRef({ removed: edits.removed, filters });
  useEffect(() => {
    const { removed } = edits;
    if (saved.current.removed === removed && saved.current.filters === filters) return;
    saved.current = { removed, filters };
    saver.update({ removed: [...removed], filters });
  }, [edits, filters, saver]);

  useEffect(() => {
    saver.onStatus = setStatus;
    const warn = (event: BeforeUnloadEvent) => {
      if (!saver.dirty) return;
      void saver.flush();
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      // Switching files unmounts this, so don't lose the last change.
      void saver.flush();
    };
  }, [saver]);

  return {
    edits,
    filters,
    setFilters,
    status,
    setRemoved: useCallback(
      (ids: Iterable<string>, remove: boolean) => {
        const list = [...ids];
        setEdits((state) => edit(state, list, remove));
      },
      [],
    ),
    undo: useCallback(() => setEdits(undo), []),
    redo: useCallback(() => setEdits(redo), []),
    retrySave: useCallback(() => void saver.flush(), [saver]),
  };
}
