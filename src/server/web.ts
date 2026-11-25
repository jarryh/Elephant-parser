import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Express } from 'express';
import { createServer, type ViteDevServer } from 'vite';

const src = fileURLToPath(new URL('..', import.meta.url));
const project = path.join(src, '..');

/**
 * Serves the UI through Vite. Vite can serve files from disk, so it only gets the
 * source and node_modules: never Data/, workspace/ or .env.
 */
export async function attachWeb(app: Express, server: Server): Promise<ViteDevServer> {
  const vite = await createServer({
    configFile: false,
    root: path.join(src, 'web'),
    cacheDir: path.join(project, 'node_modules', '.vite'),
    publicDir: false,
    appType: 'spa',
    plugins: [react()],
    server: {
      middlewareMode: true,
      hmr: { server },
      fs: {
        strict: true,
        allow: [path.join(src, 'web'), path.join(src, 'shared'), path.join(project, 'node_modules')],
        deny: ['.env', '.env.*', '*.lua', '**/.git/**'],
      },
    },
  });
  app.use(vite.middlewares);
  return vite;
}
