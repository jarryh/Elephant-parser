import { useEffect, useMemo, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import type { EntryState } from '../../shared/selection';
import type { LogDocument } from '../../shared/types';
import { useRangeToggle } from '../useRangeToggle';
import { entryHighlight, setHover, setStates } from './entryHighlight';
import { createLuaView } from './luaEditor';

/** A new object each time, so the same line can be revealed twice. */
export interface Reveal {
  id: string;
}

interface Props {
  doc: LogDocument;
  states: EntryState[];
  removed: ReadonlySet<string>;
  setRemoved: (ids: string[], remove: boolean) => void;
  reveal: Reveal | null;
}

export function RawView({ doc, states, removed, setRemoved, reveal }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const keys = useMemo(() => doc.entries.map((_, index) => index), [doc]);
  const toggle = useRangeToggle(keys, (index) => doc.entries[index]!.id, removed, setRemoved);

  const latestStates = useRef(states);
  useEffect(() => {
    latestStates.current = states;
    view.current?.dispatch({ effects: setStates.of(states) });
  }, [states]);

  useEffect(() => {
    const editor = createLuaView(host.current!, doc.source, entryHighlight(doc.entries, latestStates.current, toggle));
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [doc, toggle]);

  const goTo = (index: number) => {
    const editor = view.current;
    const entry = doc.entries[index];
    if (!editor || !entry) return;
    const line = editor.state.doc.line(Math.min(entry.startLine, editor.state.doc.lines));
    editor.dispatch({ effects: [EditorView.scrollIntoView(line.from, { y: 'center' }), setHover.of(index)] });
  };

  useEffect(() => {
    if (!reveal) return;
    // Prefer the copy that's in a selected channel.
    let index = doc.entries.findIndex((entry, i) => entry.id === reveal.id && latestStates.current[i] !== 'out');
    if (index < 0) index = doc.entries.findIndex((entry) => entry.id === reveal.id);
    goTo(index);
    // Only when a new line is asked for, not whenever the document changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  const kinds = useMemo(() => new Map(doc.items.map((item) => [item.id, item.kind])), [doc]);
  const nextSelected = () => {
    const editor = view.current;
    if (!editor) return;
    const middle = editor.scrollDOM.getBoundingClientRect();
    const block = editor.lineBlockAtHeight(middle.top + middle.height / 2 - editor.documentTop);
    const line = editor.state.doc.lineAt(block.from).number;
    const selected = (from: number) =>
      doc.entries.findIndex(
        (entry, i) => entry.startLine > from && states[i] === 'kept' && kinds.get(entry.id) === 'message',
      );
    const next = selected(line);
    goTo(next >= 0 ? next : selected(0));
  };

  return (
    <div className="raw">
      <div className="legend">
        <span className="swatch kept">selected</span>
        <span className="swatch removed">removed</span>
        <span className="swatch out">filtered out</span>
        <button className="link" onClick={nextSelected}>
          Next selected message ↓
        </button>
        <span className="hint">Click a block to remove it. The file itself is never changed. Ctrl+F searches.</span>
      </div>
      <div className="raw-editor" ref={host} />
    </div>
  );
}
