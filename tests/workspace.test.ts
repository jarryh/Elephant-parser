import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NO_FILTERS } from '../src/shared/filter';
import type { Workspace } from '../src/shared/workspace';
import { startServer, type TestServer } from './serverHelper';

const URL_PATH = '/api/files/Elephant.lua/workspace';
let server: TestServer;

beforeEach(async () => {
  server = await startServer();
});
afterEach(() => server.close());

const save = (workspace: Partial<Workspace>) =>
  server.send('PUT', URL_PATH, { revision: 0, removed: [], filters: NO_FILTERS, ...workspace });
const load = async () => JSON.parse((await server.send('GET', URL_PATH)).body) as Workspace;

describe('workspace API', () => {
  it('starts empty', async () => {
    expect(await load()).toEqual({ revision: 0, removed: [], filters: NO_FILTERS });
  });

  it('saves removals and filters', async () => {
    const filters = { ...NO_FILTERS, channels: ['#4'], from: 100 };
    expect((await save({ removed: ['abc'], filters })).status).toBe(200);
    expect(await load()).toEqual({ revision: 1, removed: ['abc'], filters });
  });

  it('refuses to overwrite edits from another tab', async () => {
    await save({ removed: ['first'] });
    expect((await save({ removed: ['second'] })).status).toBe(409);
    expect((await load()).removed).toEqual(['first']);
  });

  it('lets only one of several simultaneous saves win', async () => {
    const replies = await Promise.all(['a', 'b', 'c', 'd'].map((id) => save({ removed: [id] })));
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409, 409, 409]);
  });

  it('never writes to the Lua file or its folder', async () => {
    const before = { bytes: await readFile(server.dataFile), time: (await stat(server.dataFile)).mtimeMs };
    await save({ removed: ['abc'] });
    await save({ revision: 1, removed: [] });
    expect((await readFile(server.dataFile)).equals(before.bytes)).toBe(true);
    expect((await stat(server.dataFile)).mtimeMs).toBe(before.time);
    expect(await readdir(path.dirname(server.dataFile))).toEqual(['Elephant.lua']);
  });

  it('leaves no temporary files', async () => {
    await save({});
    expect(await readdir(path.join(server.dir, 'workspace'))).toEqual(['Elephant.lua.json']);
  });

  it('does not overwrite a damaged workspace', async () => {
    const file = path.join(server.dir, 'workspace', 'Elephant.lua.json');
    await mkdir(path.dirname(file));
    await writeFile(file, '{ damaged');
    expect((await server.send('GET', URL_PATH)).body).toContain('damaged');
    expect((await save({})).status).toBe(500);
    expect(await readFile(file, 'utf8')).toBe('{ damaged');
  });

  it('rejects invalid input and unknown files', async () => {
    expect((await server.send('PUT', URL_PATH, { removed: 'all' })).status).toBe(400);
    expect((await server.send('PUT', URL_PATH, '{ broken')).status).toBe(400);
    expect((await server.send('PUT', '/api/files/..%2Fx.lua/workspace', {})).status).toBe(404);
  });
});
