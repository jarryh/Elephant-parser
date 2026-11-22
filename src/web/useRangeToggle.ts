import { useCallback, useEffect, useRef } from 'react';

/**
 * Click toggles. Shift-click does the same thing to everything since the last click.
 *
 * `keys` is the order on screen. It's separate from the IDs because in the raw view
 * one message can appear several times.
 */
export function useRangeToggle<K>(
  keys: readonly K[],
  idOf: (key: K) => string,
  removed: ReadonlySet<string>,
  setRemoved: (ids: string[], remove: boolean) => void,
): (key: K, shift: boolean) => void {
  const anchor = useRef<{ key: K; remove: boolean } | null>(null);
  const latest = useRef({ keys, idOf, removed, setRemoved });
  useEffect(() => {
    latest.current = { keys, idOf, removed, setRemoved };
  });

  return useCallback((key: K, shift: boolean) => {
    const { keys, idOf, removed, setRemoved } = latest.current;
    const last = anchor.current;

    if (shift && last) {
      const a = keys.indexOf(last.key);
      const b = keys.indexOf(key);
      if (a >= 0 && b >= 0) {
        setRemoved(keys.slice(Math.min(a, b), Math.max(a, b) + 1).map(idOf), last.remove);
        anchor.current = { key, remove: last.remove };
        return;
      }
    }
    const remove = !removed.has(idOf(key));
    setRemoved([idOf(key)], remove);
    anchor.current = { key, remove };
  }, []);
}
