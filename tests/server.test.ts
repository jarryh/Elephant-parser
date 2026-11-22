import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoadedFile } from '../src/shared/api';
import { parseElephant } from '../src/shared/elephant';
import { attachWeb } from '../src/server/web';
import { FIXTURE_CRLF } from './helpers';
import { startServer, type TestServer } from './serverHelper';

let server: TestServer;
afterEach(() => server.close());

describe('file API', () => {
  beforeEach(async () => {
    server = await startServer();
  });

  it('lists only the Lua files', async () => {
    await writeFile(path.join(server.dir, 'Data', 'notes.txt'), 'x');
    const reply = await server.send('GET', '/api/files');
    expect(JSON.parse(reply.body)).toMatchObject([{ name: 'Elephant.lua' }]);
  });

  it('serves the parsed file, uncached', async () => {
    const reply = await server.send('GET', '/api/files/Elephant.lua');
    expect((JSON.parse(reply.body) as LoadedFile).document).toEqual(parseElephant(FIXTURE_CRLF));
    expect(reply.headers['cache-control']).toBe('no-store');
  });

  it('notices that the game saved the file again', async () => {
    await server.send('GET', '/api/files/Elephant.lua');
    await writeFile(server.dataFile, 'ElephantDB = { ["char"] = {} }');
    const reply = await server.send('GET', '/api/files/Elephant.lua');
    expect((JSON.parse(reply.body) as LoadedFile).document.items).toEqual([]);
  });

  it.each(['..%2F.env', '..%5C.env', '%2e%2e%2fpackage.json', 'C:%5CWindows%5Cwin.ini', 'missing.lua'])(
    'does not serve %s',
    async (name) => {
      expect((await server.send('GET', `/api/files/${name}`)).status).toBe(404);
    },
  );

  it('explains a file it cannot read', async () => {
    await writeFile(path.join(server.dir, 'Data', 'Other.lua'), 'OtherDB = {}');
    const reply = await server.send('GET', '/api/files/Other.lua');
    expect(reply.status).toBe(422);
    expect(reply.body).toContain('not an Elephant file');
  });

  it.each([
    ['another host (DNS rebinding)', { host: 'evil.example' }],
    ['a look-alike host', { host: 'localhost.evil.example' }],
    ['another origin', { origin: 'https://evil.example' }],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
  ])('refuses %s', async (_name, headers) => {
    expect((await server.send('GET', '/api/files', undefined, headers)).status).toBe(403);
    expect((await server.send('GET', '/API/files', undefined, headers)).status).toBe(403);
  });

  it('refuses form posts, which other websites can send', async () => {
    const reply = await server.send('POST', '/api/files', 'a=b', { 'content-type': 'text/plain' });
    expect(reply.status).toBe(403);
  });
});

describe('web server', () => {
  const project = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/').replace(/^\//, '');

  beforeEach(async () => {
    server = await startServer({}, async (app, http) => {
      const vite = await attachWeb(app, http);
      return () => vite.close();
    });
  });

  it('serves the UI', async () => {
    const reply = await server.send('GET', '/', undefined, { accept: 'text/html' });
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('<div id="root">');
  });

  it('can serve allowed source through /@fs/, so the refusals below mean something', async () => {
    const reply = await server.send('GET', `/@fs/${project}src/shared/format.ts`);
    expect(reply.body).toContain('typeLabel');
  });

  // package.json and LICENSE stand in for Data/ and .env, which don't exist on every machine.
  it.each([
    [`/@fs/${project}package.json`, '"devDependencies"'],
    [`/@fs/${project}package.json?raw`, 'devDependencies'],
    [`/@fs/${project}package.json?import&raw`, 'devDependencies'],
    [`/@fs/${project}LICENSE?raw??`, 'Permission is hereby granted'],
    [`/@fs/${project}Data/Elephant.lua`, 'ElephantDB = {'],
    [`/@fs/${project}Data/Elephant.lua?import&raw`, 'ElephantDB = {'],
    [`/@fs/${project}.env?raw`, 'ANTHROPIC_API_KEY='],
    ['/../../package.json', '"devDependencies"'],
    ['/..%2f..%2fpackage.json', '"devDependencies"'],
  ])('does not serve project files through %s', async (target, secret) => {
    const reply = await server.send('GET', target);
    expect(reply.body.includes(secret)).toBe(false);
  });
});
