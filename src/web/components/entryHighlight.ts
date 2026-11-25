/** Paints entries in the raw view as kept, removed or filtered out, and makes them clickable. */
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { EntryState } from '../../shared/selection';
import type { Entry } from '../../shared/types';

export const setStates = StateEffect.define<EntryState[]>();
export const setHover = StateEffect.define<number>();

/** Line number -> index of its entry, or -1. */
export function indexLines(entries: Entry[]): Int32Array {
  let last = 0;
  for (const entry of entries) last = Math.max(last, entry.endLine);
  const index = new Int32Array(last + 1).fill(-1);
  entries.forEach((entry, i) => index.fill(i, entry.startLine, entry.endLine + 1));
  return index;
}

export function entryHighlight(
  entries: Entry[],
  initial: EntryState[],
  onToggle: (entry: number, shift: boolean) => void,
): Extension {
  const byLine = indexLines(entries);

  const field = StateField.define<{ states: EntryState[]; hover: number }>({
    create: () => ({ states: initial, hover: -1 }),
    update(value, transaction) {
      let next = value;
      for (const effect of transaction.effects) {
        if (effect.is(setStates)) next = { ...next, states: effect.value };
        else if (effect.is(setHover) && effect.value !== next.hover) next = { ...next, hover: effect.value };
      }
      return next;
    },
  });

  const decorations = new Map<string, Decoration>();
  const decoration = (name: string) => {
    let found = decorations.get(name);
    if (!found) {
      found = Decoration.line({ class: name });
      decorations.set(name, found);
    }
    return found;
  };

  const paint = (view: EditorView): DecorationSet => {
    const { states, hover } = view.state.field(field);
    const builder = new RangeSetBuilder<Decoration>();
    let painted = 0;

    for (const { from, to } of view.visibleRanges) {
      const first = Math.max(painted + 1, view.state.doc.lineAt(from).number);
      const last = view.state.doc.lineAt(to).number;
      for (let number = first; number <= last; number++) {
        const index = byLine[number] ?? -1;
        if (index < 0) continue;
        let name = `entry entry-${states[index] ?? 'kept'}`;
        if (index === hover) {
          name += ' entry-hover';
          if (number === entries[index]!.startLine) name += ' entry-hover-first';
        }
        const line = view.state.doc.line(number);
        builder.add(line.from, line.from, decoration(name));
      }
      painted = last;
    }
    return builder.finish();
  };

  const painter = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = paint(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.startState.field(field) !== update.state.field(field)) {
          this.decorations = paint(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  const entryUnder = (event: MouseEvent, view: EditorView): number => {
    const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
    if (event.clientY > view.documentTop + view.contentHeight) return -1;
    return byLine[view.state.doc.lineAt(block.from).number] ?? -1;
  };

  const mouse = EditorView.domEventHandlers({
    mousemove(event, view) {
      const index = entryUnder(event, view);
      if (index !== view.state.field(field).hover) view.dispatch({ effects: setHover.of(index) });
    },
    mouseleave(_event, view) {
      view.dispatch({ effects: setHover.of(-1) });
    },
    mousedown(event) {
      if (!event.shiftKey) return false;
      event.preventDefault();
      return true;
    },
    click(event, view) {
      if (event.button !== 0) return false;
      if (!event.shiftKey && window.getSelection()?.toString()) return false;
      const index = entryUnder(event, view);
      if (index < 0) return false;
      onToggle(index, event.shiftKey);
      return true;
    },
  });

  return [field, painter, mouse];
}
