import { useCallback, useEffect, useState } from 'react';
import type { AppConfig, DataFile, LoadedFile } from '../shared/api';
import { api } from './api';
import { Editor } from './Editor';

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

  const picker = (
    <div className="file-picker">
      {files && files.length > 0 && (
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
      )}
      <button onClick={reload} disabled={busy} title="Read the file from disk again">
        {busy ? 'Loading…' : 'Reload'}
      </button>
    </div>
  );

  if (loaded) {
    return <Editor key={loaded.file.name} loaded={loaded} picker={picker} loadError={error} story={story} />;
  }

  return (
    <main className="welcome">
      <h1>Elephant parser</h1>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : busy ? (
        <p>Reading your logs…</p>
      ) : (
        <p>
          No logs found. Copy <code>Elephant.lua</code> from{' '}
          <code>World of Warcraft\_retail_\WTF\Account\…\SavedVariables</code> into the <code>Data</code> folder of
          this project, then press Reload.
        </p>
      )}
      {picker}
    </main>
  );
}
