import { useEffect, useMemo, useRef } from 'react';
import { exportLua } from '../../shared/export';
import type { EntryState } from '../../shared/selection';
import type { LogDocument } from '../../shared/types';
import { createLuaView } from './luaEditor';

interface Props {
  doc: LogDocument;
  states: EntryState[];
}

/** Exactly what the Lua export will contain. */
export function LuaPreview({ doc, states }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const text = useMemo(() => exportLua(doc, states), [doc, states]);

  useEffect(() => {
    const view = createLuaView(host.current!, text);
    return () => view.destroy();
  }, [text]);

  return <div className="raw-editor lua-preview" ref={host} />;
}
