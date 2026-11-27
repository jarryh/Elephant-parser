import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig, DataFile, LoadedFile } from '../shared/api';
import { addFiles, NOTHING_ADDED, type Added } from './addFiles';
import { api } from './api';
import { Editor } from './Editor';
import { useFileDrop } from './useFileDrop';

export function App() {
  const [files, setFiles] = useState<DataFile[] | null>(null);
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [version, setVersion] = useState(0);

  const [story, setStory] = useState<AppConfig['story']>(null);
  useEffect(() => {
    // Again on focus, so the Story button appears right after a key is added to .env.
    const refresh = () => void api.config().then((config) => setStory(config.story), () => {});
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setBusy(true);

    (async () => {
      const list = await api.files(signal);
      const wanted = list.find((file) => file.name === name) ?? list[0];
      const next = wanted ? await api.load(wanted.name, signal) : null;
      if (signal.aborted) return;
      setFiles(list);
      setLoaded(next);
      setError('');
      setBusy(false);
    })().catch((cause: unknown) => {
      if (signal.aborted) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
      // Still list the files, so that another one can be picked.
      api.files(signal).then(setFiles, () => {});
    });

    return () => controller.abort();
  }, [name, version]);

  const [added, setAdded] = useState<Added>(NOTHING_ADDED);
  const [adding, setAdding] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const chooser = useRef<HTMLInputElement>(null);

  /** One batch after another, so that a second drop can't overtake the first. */
  const add = useCallback(
    (chosen: File[]) => {
      setAdding((count) => count + 1);
      queue.current = queue.current.then(async () => {
        const result = await addFiles(chosen);
        setAdded(result);
        setAdding((count) => count - 1);
        if (!result.opened) return;
        setLoaded((current) => (current?.file.name === result.opened ? current : null));
        setName(result.opened);
        reload();
      });
    },
    [reload],
  );
  const dragging = useFileDrop(add);

  const picker = (
    <div className="file-picker">
      {files && files.length > 0 && (
        <label className="file-choice">
          File
          <select
            aria-label="File in Data folder"
            value={name || loaded?.file.name || files[0]!.name}
            onChange={(event) => {
              setLoaded(null);
              setName(event.target.value);
            }}
          >
            {files.map((file) => (
              <option key={file.name} value={file.name}>
                {file.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button onClick={reload} disabled={busy} title="Read the file from disk again">
        {busy ? 'Loading…' : 'Reload'}
      </button>
      <button
        onClick={() => chooser.current?.click()}
        disabled={adding > 0}
        title="Add StoryLog.lua or Elephant.lua to the Data folder. You can also drop it anywhere on this window."
      >
        {adding > 0 ? 'Adding…' : 'Add file…'}
      </button>
      <input
        ref={chooser}
        type="file"
        accept=".lua"
        multiple
        hidden
        aria-label="Log files to add"
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []);
          // So that choosing the same file again is still a change.
          event.target.value = '';
          if (chosen.length) add(chosen);
        }}
      />
    </div>
  );

  const notes = (added.notes.length > 0 || added.problems.length > 0) && (
    <div className="file-notes">
      {added.problems.length > 0 && (
        <p className="banner error" role="alert">
          {added.problems.join(' ')}
        </p>
      )}
      {added.notes.length > 0 && (
        <p className="banner note" role="status">
          {added.notes.join(' ')}
        </p>
      )}
      <button className="link" onClick={() => setAdded(NOTHING_ADDED)} aria-label="Close the message about added files">
        Close
      </button>
    </div>
  );

  const overlay = dragging && (
    <div className="drop-overlay">
      <p>
        <strong>Drop to add to the Data folder</strong>
        StoryLog.lua or Elephant.lua. A file of the same name is kept under a dated name, unless the new
        one holds all of it.
      </p>
    </div>
  );

  if (loaded) {
    return (
      <>
        <Editor key={loaded.file.name} loaded={loaded} picker={picker} notes={notes} loadError={error} story={story} />
        {overlay}
      </>
    );
  }

  return (
    <main className="welcome">
      <h1>StoryLog</h1>
      {notes}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : busy ? (
        <p>Reading your logs…</p>
      ) : (
        <>
          <p>
            No logs yet. Drop <code>StoryLog.lua</code> or <code>Elephant.lua</code> on this window, or press{' '}
            <strong>Add file…</strong>
          </p>
          <p className="hint">
            WoW keeps them in <code>World of Warcraft\_forever_\WTF\Account\…\SavedVariables</code> (for retail,{' '}
            <code>_retail_</code> instead of <code>_forever_</code>). You can also copy them into the <code>Data</code>{' '}
            folder of this project and press Reload.
          </p>
        </>
      )}
      {picker}
      {overlay}
    </main>
  );
}
