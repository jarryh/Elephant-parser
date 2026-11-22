import express, { type ErrorRequestHandler, type Express } from 'express';
import { parseWorkspace } from '../shared/workspace';
import { DataFiles } from './dataFiles';
import { HttpError } from './errors';
import { localOnly } from './guard';
import { WorkspaceStore } from './workspaceStore';

export interface AppOptions {
  dataDir: string;
  workspaceDir: string;
}

export function createApp({ dataDir, workspaceDir }: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(localOnly);

  const files = new DataFiles(dataDir);
  const workspaces = new WorkspaceStore(workspaceDir);
  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '10mb' }));

  api.get('/files', async (_req, res) => {
    res.json(await files.list());
  });
  api.get('/files/:name', async (req, res) => {
    res.json(await files.load(req.params.name));
  });
  api.get('/files/:name/workspace', async (req, res) => {
    const { name } = await files.find(req.params.name);
    res.json(await workspaces.read(name));
  });
  api.put('/files/:name/workspace', async (req, res) => {
    const { name } = await files.find(req.params.name);
    const workspace = parseWorkspace(req.body);
    if (!workspace) throw new HttpError(400, 'These edits are not in a valid format.');
    res.json({ revision: await workspaces.write(name, workspace) });
  });

  api.use(() => {
    throw new HttpError(404, 'Unknown API route.');
  });
  api.use(handleError);
  app.use('/api', api);
  return app;
}

const handleError: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const status: unknown = error?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: 'The request was malformed or too large.' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Something went wrong on the local server. Details are in the terminal.' });
};
