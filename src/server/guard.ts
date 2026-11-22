import type { RequestHandler, Response } from 'express';

/*
 * The server holds private chat and an API key, and any website you visit can send
 * requests to localhost. Hence these two checks.
 */

const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

function refuse(res: Response): void {
  res.status(403).json({ error: 'Request refused: this app only serves itself.' });
}

/** For every request. Host must be local, which stops DNS rebinding. */
export const localHostOnly: RequestHandler = (req, res, next) => {
  if (!LOCAL_HOST.test(req.headers.host ?? '')) return refuse(res);
  // Vite's "open in editor" URL would let any website start programs on this computer.
  if (decodeLoosely(req.url).toLowerCase().includes('open-in-editor')) return refuse(res);
  next();
};

/** For the API. No cross-site requests, and changes must be same-origin JSON. */
export const sameOriginOnly: RequestHandler = (req, res, next) => {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return refuse(res);

  const { origin, host } = req.headers;
  if (origin !== undefined && origin !== `http://${host}`) return refuse(res);

  const changes = req.method !== 'GET' && req.method !== 'HEAD';
  if (changes && !req.headers['content-type']?.startsWith('application/json')) return refuse(res);
  next();
};

function decodeLoosely(url: string): string {
  return url.replace(/%([0-7][0-9a-fA-F])/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
