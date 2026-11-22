import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { readEnv } from './env';
import { attachWeb } from './web';

const root = fileURLToPath(new URL('../..', import.meta.url));
const envFile = path.join(root, '.env');
const port = Number(process.env.PORT || readEnv(envFile).PORT || 5180);

const app = createApp({ dataDir: path.join(root, 'Data') });
const server = createServer(app);

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Is the app already running? Otherwise set PORT=... in .env.`
      : error.message,
  );
  process.exit(1);
});

await attachWeb(app, server);
server.listen(port, '127.0.0.1', () => {
  console.log(`\n  Elephant parser is running at http://127.0.0.1:${port}\n  Press Ctrl+C to stop.\n`);
});
