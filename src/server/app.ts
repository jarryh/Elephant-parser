import express, { type ErrorRequestHandler, type Express } from 'express';
import { DataFiles } from './dataFiles';
import { HttpError } from './errors';
import { localOnly } from './guard';

export interface AppOptions {
  dataDir: string;
}

export function createApp({ dataDir }: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(localOnly);

  const files = new DataFiles(dataDir);
  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.get('/files', async (_req, res) => {
    res.json(await files.list());
  });
  api.get('/files/:name', async (req, res) => {
    res.json(await files.load(req.params.name));
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
