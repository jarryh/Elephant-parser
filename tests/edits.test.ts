import { describe, expect, it } from 'vitest';
import { createEdits, edit, redo, undo } from '../src/shared/edits';
import { parseElephant } from '../src/shared/elephant';
import { NO_FILTERS } from '../src/shared/filter';
import { computeSelection } from '../src/shared/selection';
import { parseWorkspace } from '../src/shared/workspace';
import { FIXTURE } from './helpers';

describe('edits', () => {
  it('remove, restore, undo and redo', () => {
    let state = edit(createEdits(), ['a', 'b'], true);
    state = edit(state, ['a'], false);
    expect([...state.removed]).toEqual(['b']);

    state = undo(state);
    expect([...state.removed].sort()).toEqual(['a', 'b']);
    state = undo(state);
    expect(state.removed.size).toBe(0);
    state = redo(redo(state));
    expect([...state.removed]).toEqual(['b']);
  });

  it('undo only what that step changed', () => {
    const state = edit(createEdits(['a']), ['a', 'b'], true);
    expect([...undo(state).removed]).toEqual(['a']);
  });

  it('ignore edits that change nothing', () => {
    const state = createEdits(['a']);
    expect(edit(state, ['a'], true)).toBe(state);
    expect(undo(state)).toBe(state);
    expect(redo(state)).toBe(state);
  });

  it('a new edit discards redo', () => {
    const state = edit(undo(edit(createEdits(), ['a'], true)), ['b'], true);
    expect(state.future).toEqual([]);
  });
});

describe('selection', () => {
  const doc = parseElephant(FIXTURE);
  const id = (text: string) => doc.items.find((item) => item.text.includes(text))!.id;
  const stateOf = (text: string, filters = NO_FILTERS, removed = new Set<string>()) => {
    const { states } = computeSelection(doc, filters, removed);
    return doc.entries.flatMap((entry, i) => (entry.id === id(text) ? states[i]! : []));
  };

  it('removes every copy of a message', () => {
    expect(stateOf('gates', NO_FILTERS, new Set([id('gates')]))).toEqual(['removed', 'removed']);
  });

  it('keeps a shared message only in the selected channel', () => {
    expect(stateOf('gates', { ...NO_FILTERS, channels: ['#3'] })).toEqual(['out', 'kept']);
  });

  it('keeps markers through filters, but not through removal', () => {
    const filters = { ...NO_FILTERS, text: 'nothing matches this' };
    expect(stateOf('03/02/2030', filters)).toEqual(['kept']);
    expect(stateOf('03/02/2030', filters, new Set([id('03/02/2030')]))).toEqual(['removed']);
  });

  it('leaves removed messages in view, but out of the selection', () => {
    const { matched, messages } = computeSelection(doc, NO_FILTERS, new Set([id('bows')]));
    expect(matched.map((item) => item.id)).toContain(id('bows'));
    expect(messages.map((item) => item.id)).not.toContain(id('bows'));
  });
});

describe('parseWorkspace', () => {
  const valid = { revision: 2, removed: ['abc'], filters: NO_FILTERS };

  it('accepts a valid workspace and tidies its filters', () => {
    expect(parseWorkspace(valid)).toEqual(valid);
    expect(parseWorkspace({ ...valid, filters: { owners: ['A', 7], from: 'x' } })?.filters).toEqual({
      ...NO_FILTERS,
      owners: ['A'],
    });
  });

  it.each([
    null,
    [],
    {},
    { ...valid, revision: -1 },
    { ...valid, removed: ['../x'] },
    { ...valid, removed: 'abc' },
    { ...valid, filters: null },
  ])('rejects %j', (value) => {
    expect(parseWorkspace(value)).toBeNull();
  });
});
