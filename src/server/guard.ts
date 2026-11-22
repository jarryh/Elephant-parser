import type { RequestHandler } from 'express';

const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

/**
 * The server holds private chat and an API key, and any website you visit can send
 * requests to localhost. So:
 * - Host must be local, which stops DNS rebinding.
 * - Cross-site API requests are refused, and changes must be same-origin JSON.
 */
export const localOnly: RequestHandler = (req, res, next) => {
  const refuse = () => void res.status(403).json({ error: 'Request refused: this app only serves itself.' });
  const host = req.headers.host ?? '';
  if (!LOCAL_HOST.test(host)) return refuse();

  if (req.path.toLowerCase().startsWith('/api')) {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return refuse();

    const { origin } = req.headers;
    if (origin !== undefined && origin !== `http://${host}`) return refuse();

    const changes = req.method !== 'GET' && req.method !== 'HEAD';
    if (changes && !req.headers['content-type']?.startsWith('application/json')) return refuse();
  }
  next();
};
