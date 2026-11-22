import { useEffect, useState, type ReactNode } from 'react';
import type { AppConfig, LoadedFile } from '../shared/api';
import type { Workspace } from '../shared/workspace';
import { api } from './api';
import { Workbench } from './Workbench';

interface Props {
  loaded: LoadedFile;
  picker: ReactNode;
  loadError: string;
  story: AppConfig['story'];
}

/** Nothing can be edited until the saved edits are loaded, or they could be overwritten. */
export function Editor({ loaded, picker, loadError, story }: Props) {
  const { name } = loaded.file;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api.workspace(name, controller.signal).then(setWorkspace, (cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [name]);

  if (workspace) {
    return <Workbench loaded={loaded} initial={workspace} picker={picker} loadError={loadError} story={story} />;
  }

  return (
    <main className="welcome">
      <h1>Elephant parser</h1>
      {error ? (
        <>
          <p className="error" role="alert">
            {error}
          </p>
          <button onClick={() => location.reload()}>Try again</button>
        </>
      ) : (
        <p>Loading your edits…</p>
      )}
      {picker}
    </main>
  );
}
