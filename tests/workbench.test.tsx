// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseElephant } from '../src/shared/elephant';
import { NO_FILTERS } from '../src/shared/filter';
import { parseLog } from '../src/shared/parse';
import type { AppConfig } from '../src/shared/api';
import type { Workspace } from '../src/shared/workspace';
import { indexLines } from '../src/web/components/entryHighlight';
import { Workbench } from '../src/web/Workbench';
// jsdom changes URL, so the fixture can't come from helpers.ts.
import fixture from './fixtures/elephant.lua?raw';
import storyFixture from './fixtures/storylog.lua?raw';

const doc = parseElephant(fixture.replace(/\r\n/g, '\n'));
const storyDoc = parseLog(storyFixture.replace(/\r\n/g, '\n'));
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

function show(patch: Partial<Workspace> = {}, story: AppConfig['story'] = null, document = doc) {
  return render(
    <Workbench
      loaded={{ file: { name: 'Elephant.lua', size: 1, modified: 0 }, document }}
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

  it('closes the menu on an outside click, without removing anything', () => {
    show();
    fireEvent.contextMenu(line('bows'));
    fireEvent.click(document.querySelector('.menu-backdrop')!);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(removed().some(Boolean)).toBe(false);
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

describe('a StoryLog file', () => {
  const showStory = (story: AppConfig['story'] = null) => show({ filters: NO_FILTERS }, story, storyDoc);
  /** The first evenings, where the map tests stand. The last session is a day on the road elsewhere. */
  const evenings = { ...storyDoc, items: storyDoc.items.filter((item) => item.at < 1898900000) };

  it('shows the place where it changes', () => {
    showStory();
    expect([...document.querySelectorAll('.place-chip')].map((chip) => chip.textContent)).toEqual([
      'Stormwind City, Cathedral Square',
      'The Stockade',
      "Elwynn Forest, Goldshire, Lion's Pride Inn",
      'Dun Morogh',
      'Elwynn Forest, Goldshire',
      'Westfall, Sentinel Hill',
      'Stormwind City, Trade District',
    ]);
  });

  it('shows what happened, with the long text of a line under it', () => {
    showStory();
    expect(line('Traded with Borin Ironvow').textContent).toContain('[Trade] Traded with Borin Ironvow: gave 15s; got [Linen Cloth] ×5');
    expect(within(line('Read “A Weathered Plaque”')).getByText('Here stood the old mill.').className).toBe('detail');
    expect(line('brb, doorbell').textContent).toContain('<OOC>');
    // The text names whom the trade was with, so the target is not shown again.
    expect(line('Traded with').textContent).not.toContain('→');
    expect(screen.getByLabelText(/^Trades and items/)).toBeTruthy();
  });

  it('shows who joined the group, and links a quest to Wowhead', () => {
    showStory();
    expect(line('In a party with Borin Ironvow').classList).toContain('group-change');

    const accepted = line('from Gatekeeper Dummy');
    expect(accepted.textContent).toContain('[Quest accepted] [A Test of Patience], from Gatekeeper Dummy');
    // The NPC is in the text, so it is not shown again as the target.
    expect(accepted.textContent).not.toContain('→');
    const link = within(accepted).getByText('[A Test of Patience]');
    expect(link.getAttribute('href')).toBe('https://www.wowhead.com/forever/quest=90210');
    expect(screen.getByLabelText(/^Quests/)).toBeTruthy();
  });

  it('names the group members of a scene who said nothing', () => {
    const quiet = { ...storyDoc, items: storyDoc.items.filter((item) => item.sender !== 'Borin Fixture') };
    show({ filters: NO_FILTERS }, null, quiet);
    const scene = screen.getByRole('button', { name: /^The bargain/ });
    expect(scene.textContent).toContain('also present: Borin Ironvow');
    expect(scene.title).toContain('Also in the group: Borin Ironvow');
  });

  it('shows roleplay names, with the character in the tooltip', () => {
    showStory();
    const name = within(line('bows')).getByText('Borin Ironvow');
    expect(name.title).toBe('Character: Borin Fixture');
  });

  it('selects a scene, and clears it on a second click', () => {
    showStory();
    const scene = () => screen.getByRole('button', { name: /^The bargain/ });
    fireEvent.click(scene());
    expect(line('Well met')).toBeDefined();
    expect(line('Dark in here')).toBeUndefined();
    // Exactly its eleven lines and its note: not the whisper or the channel line from the same minutes.
    expect(lines()).toHaveLength(12);
    expect(line('private secret')).toBeUndefined();
    expect(line('red door')).toBeUndefined();
    expect(scene().textContent).toContain('Borin Ironvow 4');
    fireEvent.click(scene());
    expect(line('Dark in here')).toBeDefined();
  });

  it('follows an item link without removing the line', () => {
    showStory();
    const link = within(line('friend.')).getByRole('link');
    expect(link.getAttribute('href')).toBe('https://www.wowhead.com/forever/item=12345');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(line('friend.').classList).not.toContain('removed');
  });

  it('looks up an NPC on Wowhead, but not a player', () => {
    showStory();
    fireEvent.contextMenu(line('gates open'));
    expect(screen.getByText('Look up on Wowhead').getAttribute('href')).toMatch(/npc=90001$/);
    fireEvent.click(document.querySelector('.menu-backdrop')!);
    fireEvent.contextMenu(line('bows'));
    expect(screen.queryByText('Look up on Wowhead')).toBeNull();
  });

  it('puts the selection on the map, and goes from a dot to its line', () => {
    show({ filters: NO_FILTERS }, null, evenings);
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }));
    const dot = document.querySelector(`.dot[data-ids="${storyDoc.items.find((item) => item.text.includes('friend.'))!.id}"]`)!;
    fireEvent.click(dot);
    expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.flashed')?.textContent).toContain('friend.');
  });

  it('shows another map when a scene leaves nothing on the chosen one', () => {
    showStory();
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }));
    const menu = () => document.querySelector<HTMLSelectElement>('select[aria-label="Map"]')!;
    fireEvent.change(menu(), { target: { value: '1429' } });
    fireEvent.change(menu(), { target: { value: '1453' } });
    expect(menu().value).toBe('1453');
    // The second evening was in Elwynn Forest alone.
    fireEvent.click(screen.getByRole('button', { name: /^Elwynn Forest/ }));
    expect(menu().value).toBe('1429');
    expect(document.querySelectorAll('.dot')).toHaveLength(1);
    // And the choice comes back with its lines.
    fireEvent.click(screen.getByRole('button', { name: /^Elwynn Forest/ }));
    expect(menu().value).toBe('1453');
  });

  it('colours the busiest players on the map, and draws nobody who was not there', () => {
    show({ filters: NO_FILTERS }, null, evenings);
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }));
    const side = within(document.querySelector<HTMLElement>('.map-side')!);
    const coloured = [...document.querySelectorAll('.map-person[aria-pressed="true"]')].map((person) => person.textContent);
    expect(coloured).toEqual(['Élowyn Moonwhisper4', 'Borin Ironvow3', 'Cedra Mock1']);
    expect(side.queryByText('Battle.net friend')).toBeNull();
    expect(side.queryByText('Dorn Placeholder')).toBeNull();
  });

  it('lists senders by roleplay name too', () => {
    showStory();
    expect(screen.getByText('Borin Ironvow (Borin Fixture)')).toBeDefined();
    fireEvent.contextMenu(line('bows'));
    expect(screen.getByText('Show only Borin Ironvow')).toBeDefined();
  });

  it('sends places and cast with a story', () => {
    showStory({ model: 'claude-opus-5-5' });
    fireEvent.click(screen.getByText('Story…'));
    const sent = screen.getByLabelText('Turn the selection into a story').querySelector('pre')!.textContent;
    expect(sent).toContain('Place: Stormwind City, Cathedral Square');
    expect(sent).toContain('Cast:');
  });
});

it('has no map for an Elephant file', () => {
  show();
  expect(screen.queryByRole('tab', { name: 'Map' })).toBeNull();
});
