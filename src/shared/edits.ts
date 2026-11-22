/** Removals with undo and redo. History stores only what changed. */

export interface Change {
  ids: string[];
  remove: boolean;
}

export interface Edits {
  removed: ReadonlySet<string>;
  past: Change[];
  future: Change[];
}

export function createEdits(removed: Iterable<string> = []): Edits {
  return { removed: new Set(removed), past: [], future: [] };
}

export function edit(state: Edits, ids: Iterable<string>, remove: boolean): Edits {
  const changed = [...new Set(ids)].filter((id) => state.removed.has(id) !== remove);
  if (!changed.length) return state;
  const change = { ids: changed, remove };
  return { removed: replay(state.removed, change, remove), past: [...state.past, change], future: [] };
}

export function undo(state: Edits): Edits {
  const change = state.past.at(-1);
  if (!change) return state;
  return {
    removed: replay(state.removed, change, !change.remove),
    past: state.past.slice(0, -1),
    future: [...state.future, change],
  };
}

export function redo(state: Edits): Edits {
  const change = state.future.at(-1);
  if (!change) return state;
  return {
    removed: replay(state.removed, change, change.remove),
    past: [...state.past, change],
    future: state.future.slice(0, -1),
  };
}

function replay(removed: ReadonlySet<string>, change: Change, remove: boolean): Set<string> {
  const next = new Set(removed);
  for (const id of change.ids) {
    if (remove) next.add(id);
    else next.delete(id);
  }
  return next;
}
