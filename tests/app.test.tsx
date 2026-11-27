// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddedFile } from '../src/shared/api';
import { NO_FILTERS } from '../src/shared/filter';
import { parseLog } from '../src/shared/parse';
import { App } from '../src/web/App';
// jsdom changes URL, so the fixtures can't come from helpers.ts.
import elephant from './fixtures/elephant.lua?raw';
import storylog from './fixtures/storylog.lua?raw';

/** What the fake server holds, newest first, and what was sent to it. */
let data: Map<string, string>;
let sent: { name: string; content: string }[];
let loads: string[];
/** How the fake server answers an added file. By default it saves it. */
let answer: (name: string, content: string) => { status: number; body: AddedFile | { error: string } };

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

beforeEach(() => {
  data = new Map([['Elephant.lua', elephant]]);
  sent = [];
  loads = [];
  answer = (name, content) => {
    data = new Map([[name, content], ...data]);
    return { status: 200, body: { name, kept: null, replaced: false, unchanged: false } };
  };

  // The virtual list measures the page, and jsdom has no layout.
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(2000);
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(26);
  HTMLElement.prototype.scrollTo = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url, 'http://localhost');
    if (pathname === '/api/config') return json({ story: null });
    if (pathname === '/api/files') {
      return json([...data.keys()].map((name, index) => ({ name, size: 1, modified: -index })));
    }

    const [, encoded, workspace] = /^\/api\/files\/([^/]+)(\/workspace)?$/.exec(pathname)!;
    const name = decodeURIComponent(encoded!);
    if (workspace) return json(init?.method === 'PUT' ? { revision: 1 } : { revision: 0, removed: [], filters: NO_FILTERS });
    if (init?.method === 'PUT') {
      const { content } = JSON.parse(init.body as string) as { content: string };
      sent.push({ name, content });
      const { status, body } = answer(name, content);
      return json(body, status);
    }
    loads.push(name);
    const source = data.get(name);
    return source === undefined
      ? json({ error: 'There is no such .lua file in Data/.' }, 404)
      : json({ file: { name, size: 1, modified: 0 }, document: parseLog(source) });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const lua = (name: string, text: string) => new File([new TextEncoder().encode(text)], name);
const drag = (files: File[], types = ['Files']) => ({ dataTransfer: { types, files } });
const chosen = () => screen.getByLabelText<HTMLSelectElement>('File in Data folder').value;
const overlay = () => document.querySelector('.drop-overlay');

async function open() {
  render(<App />);
  await screen.findByLabelText('File in Data folder');
  await waitFor(() => expect(document.querySelector('.statusbar')).not.toBeNull());
}

describe('adding a file', () => {
  it('saves a dropped file as it is, and opens it', async () => {
    await open();
    fireEvent.drop(window, drag([lua('StoryLog.lua', storylog)]));

    await screen.findByText('Added StoryLog.lua.');
    expect(sent).toEqual([{ name: 'StoryLog.lua', content: storylog }]);
    await waitFor(() => expect(chosen()).toBe('StoryLog.lua'));
    await waitFor(() => expect(document.querySelector('.scenes')?.textContent).toContain('The bargain'));
  });

  it('does the same from the Add file button', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Add file…' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Log files to add'), {
      target: { files: [lua('StoryLog.lua', storylog)] },
    });

    await screen.findByText('Added StoryLog.lua.');
    await waitFor(() => expect(chosen()).toBe('StoryLog.lua'));
  });

  it('takes several at once, and opens the last', async () => {
    await open();
    fireEvent.drop(window, drag([lua('StoryLog.lua', storylog), lua('Copy.lua', elephant)]));

    await screen.findByText('Added StoryLog.lua. Added Copy.lua.');
    await waitFor(() => expect(chosen()).toBe('Copy.lua'));
    expect(sent.map((file) => file.name)).toEqual(['StoryLog.lua', 'Copy.lua']);
  });

  it('opens the first file of an empty Data folder', async () => {
    data = new Map();
    render(<App />);
    await screen.findByText(/No logs yet/);
    fireEvent.drop(window, drag([lua('StoryLog.lua', storylog)]));
    await waitFor(() => expect(chosen()).toBe('StoryLog.lua'));
  });

  it('reads a replaced file again, and says where the older one went', async () => {
    answer = (name, content) => {
      data.set(name, content);
      return { status: 200, body: { name, kept: 'Elephant-2020-03-01.lua', replaced: true, unchanged: false } };
    };
    await open();
    expect(loads).toEqual(['Elephant.lua']);
    fireEvent.drop(window, drag([lua('Elephant.lua', 'ElephantDB = { ["char"] = {} }')]));

    await screen.findByText('Replaced Elephant.lua. The older file is kept as Elephant-2020-03-01.lua.');
    await waitFor(() => expect(loads).toEqual(['Elephant.lua', 'Elephant.lua']));
    expect(chosen()).toBe('Elephant.lua');
  });

  it('says why no copy was kept of a file that the new one holds', async () => {
    data.set('StoryLog.lua', storylog);
    answer = (name, content) => {
      data.set(name, content);
      return { status: 200, body: { name, kept: null, replaced: true, unchanged: false } };
    };
    await open();
    fireEvent.drop(window, drag([lua('StoryLog.lua', storylog.replace('["limit"] = 3,', '["limit"] = 5,'))]));
    await screen.findByText('Replaced StoryLog.lua. It holds every line of the older file, so no copy was kept.');
  });

  it('says when Data already holds the file', async () => {
    answer = (name) => ({ status: 200, body: { name, kept: null, replaced: false, unchanged: true } });
    await open();
    fireEvent.drop(window, drag([lua('Elephant.lua', elephant)]));
    await screen.findByText('Elephant.lua is already in Data, with the same content.');
  });

  it('shows why the server refused a file, and keeps the open one', async () => {
    answer = (name) => ({ status: 422, body: { error: `Could not read ${name}. This is not a log.` } });
    await open();
    fireEvent.drop(window, drag([lua('Other.lua', 'OtherDB = {}')]));

    expect((await screen.findByRole('alert')).textContent).toBe('Could not read Other.lua. This is not a log.');
    expect(chosen()).toBe('Elephant.lua');
    expect(loads).toEqual(['Elephant.lua']);
    expect(document.querySelector('.statusbar')).not.toBeNull();
  });

  it('adds the good files of a drop and names the bad ones', async () => {
    await open();
    const notText = new File([new Uint8Array([0x45, 0xff, 0x45])], 'Broken.lua');
    fireEvent.drop(
      window,
      drag([lua('notes.txt', 'x'), lua('Elephant.lua.bak', elephant), notText, lua('StoryLog.lua', storylog)]),
    );

    await screen.findByText('Added StoryLog.lua.');
    const problems = screen.getByRole('alert').textContent;
    expect(problems).toContain('notes.txt is not a .lua file.');
    expect(problems).toContain("Elephant.lua.bak is WoW's backup copy.");
    expect(problems).toContain('Broken.lua is not UTF-8 text');
    expect(sent.map((file) => file.name)).toEqual(['StoryLog.lua']);
  });

  it('refuses a file that is too large without sending it', async () => {
    await open();
    const large = lua('Large.lua', elephant);
    Object.defineProperty(large, 'size', { value: 51 * 1024 * 1024 });
    fireEvent.drop(window, drag([large]));

    expect((await screen.findByRole('alert')).textContent).toContain('Large.lua is larger than 50 MB.');
    expect(sent).toEqual([]);
  });

  it('closes the message', async () => {
    await open();
    fireEvent.drop(window, drag([lua('StoryLog.lua', storylog)]));
    await screen.findByText('Added StoryLog.lua.');
    fireEvent.click(screen.getByRole('button', { name: 'Close the message about added files' }));
    expect(screen.queryByText('Added StoryLog.lua.')).toBeNull();
  });
});

describe('dragging over the window', () => {
  it('shows where files will go, until they leave or are dropped', async () => {
    await open();
    fireEvent.dragEnter(document.body, drag([]));
    expect(overlay()?.textContent).toContain('Drop to add to the Data folder');
    fireEvent.dragLeave(document.body, drag([]));
    expect(overlay()).toBeNull();

    fireEvent.dragEnter(document.body, drag([]));
    fireEvent.drop(window, drag([lua('StoryLog.lua', storylog)]));
    expect(overlay()).toBeNull();
    await screen.findByText('Added StoryLog.lua.');
  });

  it('stays while the pointer moves between elements', async () => {
    await open();
    const inside = document.querySelector('.statusbar')!;
    fireEvent.dragEnter(document.body, drag([]));
    fireEvent.dragEnter(inside, drag([]));
    fireEvent.dragLeave(document.body, drag([]));
    expect(overlay()).not.toBeNull();
    fireEvent.dragLeave(inside, drag([]));
    expect(overlay()).toBeNull();
  });

  it('keeps the browser from opening a dropped file', async () => {
    await open();
    expect(fireEvent.dragOver(document.body, drag([]))).toBe(false);
    expect(fireEvent.drop(document.body, drag([lua('notes.txt', 'x')]))).toBe(false);
  });

  it('leaves other drags alone, such as selected text', async () => {
    await open();
    fireEvent.dragEnter(document.body, drag([], ['text/plain']));
    expect(overlay()).toBeNull();
    expect(fireEvent.dragOver(document.body, drag([], ['text/plain']))).toBe(true);
    expect(fireEvent.drop(document.body, drag([], ['text/plain']))).toBe(true);
    expect(sent).toEqual([]);
  });
});
