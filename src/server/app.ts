import path from 'node:path';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { parseWorkspace } from '../shared/workspace';
import { DataFiles } from './dataFiles';
import { HttpError } from './errors';
import { localHostOnly, sameOriginOnly } from './guard';
import { addStoryRoutes } from './storyRoutes';
import { WorkspaceStore } from './workspaceStore';

export interface AppOptions {
  dataDir: string;
  workspaceDir: string;
  envFile: string;
  /** Tests point this at a fake API. */
  anthropicBaseURL?: string;
}

/** For a dropped log, which travels as JSON. The browser refuses larger files itself. */
const UPLOAD_LIMIT = '64mb';

export function createApp({ dataDir, workspaceDir, envFile, anthropicBaseURL }: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(localHostOnly);

  const files = new DataFiles(dataDir);
  const workspaces = new WorkspaceStore(workspaceDir);
  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Before the general parser, as a log can be larger than its limit.
  api.put('/files/:name', express.json({ limit: UPLOAD_LIMIT }), async (req, res) => {
    const content: unknown = (req.body as { content?: unknown } | undefined)?.content;
    if (typeof content !== 'string') throw new HttpError(400, 'No file was sent.');
    res.json(await files.add(req.params.name, content));
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

  api.get('/maps/:id', async (req, res) => {
    const image = await files.mapImage(req.params.id);
    res.set('X-Content-Type-Options', 'nosniff').type('image/jpeg').send(image);
  });

  addStoryRoutes(api, { envFile, anthropicBaseURL, storiesDir: path.join(workspaceDir, 'stories') });

  api.use(() => {
    throw new HttpError(404, 'Unknown API route.');
  });
  api.use(handleError);
  app.use('/api', sameOriginOnly, api);
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
