import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppConfig, LoadedFile } from '../shared/api';
import { channelLabels, createMatcher, NO_FILTERS, type Filters } from '../shared/filter';
import { computeScenes } from '../shared/scenes';
import { computeSelection } from '../shared/selection';
import type { LogItem, Place } from '../shared/types';
import type { Workspace } from '../shared/workspace';
import { gameOf } from '../shared/wowhead';
import { ChatView } from './components/ChatView';
import { ExportDialog } from './components/ExportDialog';
import { FilterPanel } from './components/FilterPanel';
import { LineMenu, type MenuTarget } from './components/LineMenu';
import { MapView } from './components/MapView';
import type { Reveal } from './components/RawView';
import { StoryDialog } from './components/StoryDialog';
import { useWorkspace } from './useWorkspace';

// CodeMirror is large, so load it when the raw tab is first opened.
const RawView = lazy(() => import('./components/RawView').then((module) => ({ default: module.RawView })));

const NO_PLACES: Place[] = [];

type Tab = 'chat' | 'raw' | 'map';
type RemovedView = 'show' | 'hide' | 'only';

interface Props {
  loaded: LoadedFile;
  initial: Workspace;
  picker: ReactNode;
  notes?: ReactNode;
  loadError: string;
  story: AppConfig['story'];
}

export function Workbench({ loaded, initial, picker, notes, loadError, story }: Props) {
  const { document: doc, file } = loaded;
  const workspace = useWorkspace(file.name, initial);
  const { edits, filters, setFilters, status, setRemoved, undo, redo } = workspace;
  const { removed } = edits;

  const [tab, setTab] = useState<Tab>('chat');
  const [rawOpened, setRawOpened] = useState(false);
  const [mapOpened, setMapOpened] = useState(false);
  const [removedView, setRemovedView] = useState<RemovedView>('show');
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [notice, setNotice] = useState('');
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [chatReveal, setChatReveal] = useState<Reveal | null>(null);
  const [exporting, setExporting] = useState(false);
  // Keep the model, so losing the key mid-story doesn't close the dialog.
  const [storyModel, setStoryModel] = useState<string | null>(null);

  const applied = useDeferredValue(filters);
  const selection = useMemo(() => computeSelection(doc, applied, removed), [doc, applied, removed]);
  const { matched, messages, states } = selection;

  const visible = useMemo(() => {
    if (removedView === 'show') return matched;
    const wanted = removedView === 'only';
    return matched.filter((item) => removed.has(item.id) === wanted);
  }, [matched, removed, removedView]);

  const labels = useMemo(() => channelLabels(doc), [doc]);
  const scenes = useMemo(() => computeScenes(doc.items, doc.places, doc), [doc]);
  const game = useMemo(() => gameOf(doc), [doc]);
  const allMessages = useMemo(() => doc.items.filter((item) => item.kind === 'message'), [doc]);
  const removedCount = useMemo(
    () => allMessages.filter((item) => removed.has(item.id)).length,
    [allMessages, removed],
  );
  const filtered = JSON.stringify({ ...filters, showMarkers: false }) !== JSON.stringify(NO_FILTERS);

  /** An edit of many messages, with an offer to undo it. */
  const bulk = useCallback(
    (items: LogItem[], remove: boolean, what = '') => {
      const ids = items.filter((item) => removed.has(item.id) !== remove).map((item) => item.id);
      const verb = remove ? 'Removed' : 'Restored';
      const noun = ids.length === 1 ? 'message' : 'messages';
      if (!ids.length) return;
      setNotice(`${verb} ${ids.length} ${noun}${what}.`);
      setRemoved(ids, remove);
    },
    [removed, setRemoved],
  );

  /** An edit by clicking. The notice goes, as its Undo would now undo this instead. */
  const editByClick = useCallback(
    (ids: string[], remove: boolean) => {
      setNotice('');
      setRemoved(ids, remove);
    },
    [setRemoved],
  );

  /** From the filter panel: within the chosen characters and period, like its counts. */
  const removeGroup = useCallback(
    (patch: Partial<Filters>, label: string) => {
      const { owners, from, to } = filters;
      bulk(allMessages.filter(createMatcher({ ...NO_FILTERS, owners, from, to, ...patch })), true, ` (${label})`);
    },
    [allMessages, bulk, filters],
  );

  const showRaw = useCallback((id?: string) => {
    setRawOpened(true);
    setTab('raw');
    if (id) setReveal({ id });
  }, []);

  const showInChat = useCallback((id: string) => {
    setTab('chat');
    // The map shows what isn't removed, which that view hides.
    setRemovedView((current) => (current === 'only' ? 'show' : current));
    setChatReveal({ id });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement;
      // Leave typing, and dialogs, alone.
      if (target.closest?.('textarea, select, input:not([type="checkbox"], [type="radio"]), dialog')) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) undo();
      else if (key === 'y' || (key === 'z' && event.shiftKey)) redo();
      else return;
      event.preventDefault();
      setNotice('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>StoryLog</h1>
        {picker}
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
            Chat
          </button>
          <button role="tab" aria-selected={tab === 'raw'} onClick={() => showRaw()}>
            Raw Lua
          </button>
          {/* A reload can bring a file without places while the map is open, so the tab stays then. */}
          {(!!doc.places?.length || tab === 'map') && (
            <button
              role="tab"
              aria-selected={tab === 'map'}
              onClick={() => {
                setMapOpened(true);
                setTab('map');
              }}
            >
              Map
            </button>
          )}
        </div>
        <div className="toolbar actions">
          <button onClick={() => setExporting(true)}>Export…</button>
          {story && (
            <button className="primary" onClick={() => setStoryModel(story.model)}>
              Story…
            </button>
          )}
        </div>
      </header>

      {notes}
      {loadError && (
        <p className="banner error" role="alert">
          {loadError}
        </p>
      )}
      {status.state === 'failed' && (
        <p className="banner error" role="alert">
          Not saved: {status.message} {status.canRetry && <button onClick={workspace.retrySave}>Retry</button>}
        </p>
      )}

      <div className="workarea">
        <FilterPanel doc={doc} scenes={scenes} filters={filters} onChange={setFilters} onRemove={removeGroup} />

        <main className="stage">
          <div className="toolbar editbar">
            <button onClick={undo} disabled={!edits.past.length} title="Ctrl+Z">
              Undo
            </button>
            <button onClick={redo} disabled={!edits.future.length} title="Ctrl+Y">
              Redo
            </button>
            <span className="divider" />
            <button
              onClick={() => bulk(messages, true)}
              disabled={!messages.length}
              title="Remove every message that matches the filters"
            >
              Remove shown ({messages.length})
            </button>
            <button
              onClick={() => bulk(matched, false)}
              disabled={!matched.some((item) => removed.has(item.id))}
              title="Restore removed messages that match the filters"
            >
              Restore shown
            </button>
            <button
              onClick={() => {
                setRemoved(removed, false);
                setNotice('Restored everything.');
              }}
              disabled={!removed.size}
            >
              Restore all
            </button>
            <span className="divider" />
            <select
              aria-label="Removed messages"
              value={removedView}
              onChange={(event) => setRemovedView(event.target.value as RemovedView)}
            >
              <option value="show">Show removed, struck through</option>
              <option value="hide">Hide removed</option>
              <option value="only">Only removed</option>
            </select>
            <span className="hint">Click = remove or restore · Shift+click = range · Right-click = more</span>
          </div>

          <div className="panes">
            {/* Both stay mounted, to keep their scroll positions. */}
            <div className={tab === 'chat' ? 'pane' : 'pane inactive'}>
              <ChatView
                items={visible}
                order={matched}
                removed={removed}
                setRemoved={editByClick}
                onMenu={setMenu}
                scenes={scenes}
                places={doc.places}
                game={game}
                reveal={chatReveal}
              />
            </div>
            {mapOpened && (
              <div className={tab === 'map' ? 'pane' : 'pane inactive'}>
                <MapView items={messages} places={doc.places ?? NO_PLACES} onJump={showInChat} />
              </div>
            )}
            {rawOpened && (
              <div className={tab === 'raw' ? 'pane' : 'pane inactive'}>
                <Suspense fallback={<p className="nothing">Loading the Lua view…</p>}>
                  <RawView doc={doc} states={states} removed={removed} setRemoved={editByClick} reveal={reveal} />
                </Suspense>
              </div>
            )}
          </div>

          {notice && (
            <div className="toast" role="status">
              {notice}
              <button
                className="link"
                onClick={() => {
                  undo();
                  setNotice('');
                }}
              >
                Undo
              </button>
            </div>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span>
          <strong>{messages.length}</strong> selected of {allMessages.length} messages
        </span>
        <span>{removedCount} removed</span>
        {filtered && (
          <span>
            Filters active ·{' '}
            <button className="link" onClick={() => setFilters(NO_FILTERS)}>
              clear
            </button>
          </span>
        )}
        <span className="spacer" />
        <span>{status.state === 'saving' ? 'Saving…' : status.state === 'saved' ? 'Edits saved' : 'Not saved'}</span>
        <span>Game saved the file: {new Date(file.modified).toLocaleString()}</span>
      </footer>

      {storyModel && (
        <StoryDialog model={storyModel} doc={doc} messages={selection.story} onClose={() => setStoryModel(null)} />
      )}

      {exporting && (
        <ExportDialog
          fileName={file.name}
          doc={doc}
          messages={messages}
          states={states}
          labels={labels}
          onClose={() => setExporting(false)}
        />
      )}

      {menu && (
        <LineMenu
          target={menu}
          messages={allMessages}
          labels={labels}
          speakers={doc.speakers}
          game={game}
          removed={removed}
          onClose={() => setMenu(null)}
          onFilter={(patch) => setFilters((current) => ({ ...current, ...patch }))}
          onBulk={bulk}
          onShowRaw={showRaw}
        />
      )}
    </div>
  );
}
