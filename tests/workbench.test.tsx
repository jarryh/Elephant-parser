// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseElephant } from '../src/shared/elephant';
import { NO_FILTERS } from '../src/shared/filter';
import type { AppConfig } from '../src/shared/api';
import type { Workspace } from '../src/shared/workspace';
import { indexLines } from '../src/web/components/entryHighlight';
import { Workbench } from '../src/web/Workbench';
// jsdom changes URL, so the fixture can't come from helpers.ts.
import fixture from './fixtures/elephant.lua?raw';

const doc = parseElephant(fixture.replace(/\r\n/g, '\n'));
const idOf = (text: string) => doc.items.find((item) => item.text.includes(text))!.id;

let saves: Workspace[];

beforeEach(() => {
  saves = [];
  // The virtual list measures the page, and jsdom has no layout.
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(2000);
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(26);
  HTMLElement.prototype.scrollTo = () => {};
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    saves.push(JSON.parse(init!.body as string) as Workspace);
    return new Response(JSON.stringify({ revision: saves.length }));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function show(patch: Partial<Workspace> = {}, story: AppConfig['story'] = null) {
  return render(
    <Workbench
      loaded={{ file: { name: 'Elephant.lua', size: 1, modified: 0 }, document: doc }}
      initial={{ revision: 0, removed: [], filters: { ...NO_FILTERS, channels: ['#4'] }, ...patch }}
      picker={null}
      loadError=""
      story={story}
    />,
  );
}

const lines = () => [...document.querySelectorAll<HTMLElement>('.chat .line')];
const line = (text: string) => lines().find((element) => element.textContent?.includes(text))!;
const removed = () => lines().map((element) => element.classList.contains('removed'));

describe('click to remove', () => {
  it('removes and restores on click', () => {
    show();
    fireEvent.click(line('bows'));
    expect(line('bows').classList).toContain('removed');
    fireEvent.click(line('bows'));
    expect(line('bows').classList).not.toContain('removed');
  });

  it('removes a range with shift-click', () => {
    show();
    const [, second, , , fifth] = lines();
    fireEvent.click(second!);
    fireEvent.click(fifth!, { shiftKey: true });
    expect(removed().slice(0, 6)).toEqual([false, true, true, true, true, false]);
  });

  it('restores a range the same way', () => {
    show();
    const [first, second, third] = lines();
    fireEvent.click(first!);
    fireEvent.click(third!, { shiftKey: true });
    fireEvent.click(first!);
    fireEvent.click(second!, { shiftKey: true });
    expect(removed().slice(0, 3)).toEqual([false, false, true]);
  });

  it('works from the keyboard', () => {
    show();
    fireEvent.keyDown(line('bows'), { key: 'Enter' });
    expect(line('bows').classList).toContain('removed');
  });

  it('undoes and redoes with the keyboard', () => {
    show();
    fireEvent.click(line('bows'));
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(line('bows').classList).not.toContain('removed');
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    expect(line('bows').classList).toContain('removed');
  });

  it('leaves Ctrl+Z in the search box to the search box', () => {
    show();
    fireEvent.click(line('bows'));
    fireEvent.keyDown(screen.getByLabelText('Search text and senders'), { key: 'z', ctrlKey: true });
    expect(line('bows').classList).toContain('removed');
  });

  it('does not remove a line when text in it is being selected', () => {
    show();
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'bows' } as Selection);
    fireEvent.click(line('bows'));
    expect(line('bows').classList).not.toContain('removed');
  });

  it('can hide what was removed', () => {
    show({ removed: [idOf('bows')] });
    fireEvent.change(screen.getByLabelText('Removed messages'), { target: { value: 'hide' } });
    expect(line('bows')).toBeUndefined();
  });

  it('opens a menu from the sender, without removing the line', () => {
    show();
    fireEvent.click(within(line('bows')).getByText('Borin Fixture'));
    expect(line('bows').classList).not.toContain('removed');
    fireEvent.click(screen.getByText(/^Remove all \d+ from Borin Fixture$/));
    expect(line('bows').classList).toContain('removed');
    expect(line('waves at you').classList).toContain('removed');
    expect(line('Well met').classList).not.toContain('removed');
  });

  it('removes a whole channel from the filter list, and offers undo', () => {
    show();
    fireEvent.click(screen.getByLabelText(/^Remove all \d+ in Say$/));
    expect(removed().every(Boolean)).toBe(true);
    fireEvent.click(within(screen.getByRole('status')).getByText('Undo'));
    expect(removed().some(Boolean)).toBe(false);
  });

  it('saves edits and filters', async () => {
    show();
    act(() => void fireEvent.click(line('bows')));
    await waitFor(() => expect(saves.at(-1)?.removed).toEqual([idOf('bows')]), { timeout: 3000 });
    expect(saves.at(-1)?.filters.channels).toEqual(['#4']);
  });

  it('does not save just because it was opened', async () => {
    show();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(saves).toEqual([]);
  });
});

describe('story', () => {
  it('has no button without an API key', () => {
    show();
    expect(screen.queryByText('Story…')).toBeNull();
  });

  it('shows the cost and the exact text before anything is sent', () => {
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    show({ filters: NO_FILTERS, removed: [idOf('bows')] }, { model: 'claude-opus-5-5' });
    fireEvent.click(screen.getByText('Story…'));

    const dialog = screen.getByLabelText('Turn the selection into a story');
    expect(dialog.textContent).toContain('input tokens (rough, counted locally)');
    expect(dialog.textContent).toMatch(/Typically .*at most about \$/);
    const sent = dialog.querySelector('pre')!.textContent!;
    expect(sent).toContain('Well met');
    expect(sent).not.toMatch(/bows \\ deeply|a private secret/);
    expect(fetched.mock.calls.filter(([url]) => String(url).includes('story'))).toEqual([]);

    fireEvent.click(within(dialog).getByLabelText(/Include whispers/));
    expect(dialog.querySelector('pre')!.textContent).toContain('a private secret');
  });
});

describe('raw Lua line index', () => {
  it('maps every line of an entry to that entry', () => {
    const index = indexLines(doc.entries);
    doc.entries.forEach((entry, i) => {
      expect(index[entry.startLine]).toBe(i);
      expect(index[entry.endLine]).toBe(i);
    });
    expect(index[1]).toBe(-1);
  });
});
