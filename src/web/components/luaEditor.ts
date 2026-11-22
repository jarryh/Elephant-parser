import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const colors = HighlightStyle.define([
  { tag: tags.string, color: '#a8cc8c' },
  { tag: tags.number, color: '#e0b97a' },
  { tag: [tags.keyword, tags.atom, tags.bool], color: '#c49cf0' },
  { tag: tags.comment, color: '#6b7280' },
]);

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--chat)', color: '#c6cad3' },
    '.cm-scroller': { fontFamily: 'Consolas, ui-monospace, monospace', fontSize: '13px', lineHeight: '19px' },
    '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)' },
  },
  { dark: true },
);

/** A read-only, highlighted Lua view with Ctrl+F. */
export function createLuaView(parent: HTMLElement, text: string, extensions: Extension = []): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        // Focusable, so that Ctrl+F reaches it.
        EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': 'Lua source' }),
        StreamLanguage.define(lua),
        syntaxHighlighting(colors),
        search({ top: true }),
        keymap.of(searchKeymap),
        theme,
        extensions,
      ],
    }),
  });
}
