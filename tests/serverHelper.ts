import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { createApp, type AppOptions } from '../src/server/app';
import { FIXTURE_CRLF } from './helpers';

export interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface TestServer {
  url: string;
  dir: string;
  dataFile: string;
  /** Unlike fetch, this can send any Host and an un-normalised path. */
  send(method: string, target: string, body?: unknown, headers?: Record<string, string>): Promise<Reply>;
  close(): Promise<void>;
}

/** A server on a random port, with a temporary folder that holds the invented log. */
export async function startServer(
  options: Partial<AppOptions> = {},
  extend?: (app: Express, server: Server) => Promise<() => Promise<void>>,
): Promise<TestServer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'elephant-test-'));
  const dataFile = path.join(dir, 'Data', 'Elephant.lua');
  await mkdir(path.dirname(dataFile));
  await writeFile(dataFile, FIXTURE_CRLF);

  const app = createApp({
    dataDir: path.join(dir, 'Data'),
    workspaceDir: path.join(dir, 'workspace'),
    envFile: path.join(dir, '.env'),
    // A dead port, so no test can reach the real API.
    anthropicBaseURL: 'http://127.0.0.1:9',
    ...options,
  });
  const server = createServer(app);
  const teardown = await extend?.(app, server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    dir,
    dataFile,
    send: (method, target, body, headers = {}) =>
      new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
        const outgoing = request(
          {
            host: '127.0.0.1',
            port,
            method,
            path: target,
            headers: {
              ...(payload === undefined
                ? {}
                : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) }),
              ...headers,
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () =>
              resolve({
                status: response.statusCode!,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
          },
        );
        outgoing.on('error', reject);
        outgoing.end(payload);
      }),
    close: async () => {
      await teardown?.();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
