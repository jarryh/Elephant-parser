import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoadedFile } from '../src/shared/api';
import { parseElephant } from '../src/shared/elephant';
import { NO_FILTERS } from '../src/shared/filter';
import { attachWeb } from '../src/server/web';
import { parseLog } from '../src/shared/parse';
import { FIXTURE_CRLF, STORYLOG_CRLF } from './helpers';
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
    expect(reply.body).toContain('not an Elephant or StoryLog file');
  });

  it('serves StoryLog files', async () => {
    await writeFile(path.join(server.dir, 'Data', 'StoryLog.lua'), STORYLOG_CRLF);
    const reply = await server.send('GET', '/api/files/StoryLog.lua');
    expect((JSON.parse(reply.body) as LoadedFile).document).toEqual(parseLog(STORYLOG_CRLF));
  });

  it('explains a file from a newer StoryLog', async () => {
    await writeFile(path.join(server.dir, 'Data', 'StoryLog.lua'), 'StoryLogDB = { ["version"] = 2 }');
    const reply = await server.send('GET', '/api/files/StoryLog.lua');
    expect(reply.status).toBe(422);
    expect(reply.body).toContain('newer StoryLog');
  });

  it('serves map images that you put in Data/maps', async () => {
    await mkdir(path.join(server.dir, 'Data', 'maps'));
    await writeFile(path.join(server.dir, 'Data', 'maps', '1453.jpg'), 'a picture');
    const reply = await server.send('GET', '/api/maps/1453');
    expect(reply.body).toBe('a picture');
    expect(reply.headers['content-type']).toBe('image/jpeg');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
  });

  it.each(['1429', '..%2FElephant', '..%5C..%5C.env', '1453.jpg', '99999999'])(
    'has no map image called %s',
    async (id) => {
      expect((await server.send('GET', `/api/maps/${id}`)).status).toBe(404);
    },
  );

  it('keeps map images from other websites', async () => {
    expect((await server.send('GET', '/api/maps/1453', undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
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

describe('adding a file', () => {
  beforeEach(async () => {
    server = await startServer();
  });

  const inData = (name = '') => path.join(server.dir, 'Data', name);
  const names = async () => (await readdir(inData())).sort();
  const add = (name: string, content: unknown, headers?: Record<string, string>) =>
    server.send('PUT', `/api/files/${name}`, { content }, headers);
  const NEWER = 'ElephantDB = { ["char"] = {} }';
  const noon = new Date(2020, 2, 1, 12);

  it('saves it byte for byte, lists it and serves it', async () => {
    const reply = await add('StoryLog.lua', STORYLOG_CRLF);
    expect(JSON.parse(reply.body)).toEqual({ name: 'StoryLog.lua', kept: null, unchanged: false });
    expect((await readFile(inData('StoryLog.lua'))).equals(Buffer.from(STORYLOG_CRLF, 'utf8'))).toBe(true);
    expect(await names()).toEqual(['Elephant.lua', 'StoryLog.lua']);

    const served = await server.send('GET', '/api/files/StoryLog.lua');
    expect((JSON.parse(served.body) as LoadedFile).document).toEqual(parseLog(STORYLOG_CRLF));
  });

  it('makes the Data folder when there is none', async () => {
    await rm(inData(), { recursive: true });
    expect((await add('StoryLog.lua', STORYLOG_CRLF)).status).toBe(200);
    expect(await names()).toEqual(['StoryLog.lua']);
  });

  it('takes a log that is larger than other requests may be', async () => {
    const large = `${FIXTURE_CRLF}-- ${'x'.repeat(11 * 1024 * 1024)}\r\n`;
    expect((await add('Large.lua', large)).status).toBe(200);
    expect((await stat(inData('Large.lua'))).size).toBe(Buffer.byteLength(large));
  });

  it('refuses one that is far too large', async () => {
    expect((await add('Huge.lua', 'x'.repeat(65 * 1024 * 1024))).status).toBe(413);
    expect(await names()).toEqual(['Elephant.lua']);
  });

  it.each([
    '..%2Fx.lua',
    '..%5Cx.lua',
    'a%2Fb.lua',
    'C:%5Cx.lua',
    'x.txt',
    'x.lua.bak',
    '.lua',
    '.hidden.lua',
    'CON.lua',
    'nul.lua',
    '%20x.lua',
    'x.lua%00',
    'x%0A.lua',
    `${'a'.repeat(120)}.lua`,
  ])('refuses the name %s', async (name) => {
    expect((await add(name, STORYLOG_CRLF)).status).toBe(400);
    expect(await names()).toEqual(['Elephant.lua']);
    expect(await readdir(server.dir)).toEqual(['Data']);
  });

  it.each([
    ["another addon's file", 'OtherDB = {}', 'not an Elephant or StoryLog file'],
    ['broken Lua', 'ElephantDB = {', 'Could not read Elephant.lua.'],
    ['a newer StoryLog', 'StoryLogDB = { ["version"] = 2 }', 'newer StoryLog'],
  ])('refuses %s, and leaves the file of that name alone', async (_name, content, message) => {
    const reply = await add('Elephant.lua', content);
    expect(reply.status).toBe(422);
    expect(reply.body).toContain(message);
    expect(await names()).toEqual(['Elephant.lua']);
    expect(await readFile(server.dataFile, 'utf8')).toBe(FIXTURE_CRLF);
  });

  it.each([
    ['no file', undefined],
    ['something other than text', { a: 1 }],
    ['text that is not well formed', `${NEWER}\ud800`],
  ])('refuses %s', async (_name, content) => {
    expect((await add('Other.lua', content)).status).toBe(400);
    expect(await names()).toEqual(['Elephant.lua']);
  });

  it('writes nothing when Data already holds exactly this file', async () => {
    await utimes(server.dataFile, noon, noon);
    const reply = await add('Elephant.lua', FIXTURE_CRLF);
    expect(JSON.parse(reply.body)).toEqual({ name: 'Elephant.lua', kept: null, unchanged: true });
    expect(await names()).toEqual(['Elephant.lua']);
    expect((await stat(server.dataFile)).mtimeMs).toBe(noon.getTime());
  });

  it('keeps the file it replaces under its date, and the edits under the name', async () => {
    await utimes(server.dataFile, noon, noon);
    const edits = { revision: 0, removed: ['abc123'], filters: NO_FILTERS };
    await server.send('PUT', '/api/files/Elephant.lua/workspace', edits);

    const reply = await add('Elephant.lua', NEWER);
    expect(JSON.parse(reply.body)).toEqual({ name: 'Elephant.lua', kept: 'Elephant-2020-03-01.lua', unchanged: false });
    expect(await names()).toEqual(['Elephant-2020-03-01.lua', 'Elephant.lua']);
    expect(await readFile(inData('Elephant-2020-03-01.lua'), 'utf8')).toBe(FIXTURE_CRLF);
    expect((await stat(inData('Elephant-2020-03-01.lua'))).mtimeMs).toBe(noon.getTime());

    const served = await server.send('GET', '/api/files/Elephant.lua');
    expect((JSON.parse(served.body) as LoadedFile).document.items).toEqual([]);
    const saved = await server.send('GET', '/api/files/Elephant.lua/workspace');
    expect(JSON.parse(saved.body)).toMatchObject({ revision: 1, removed: ['abc123'] });
    // The newest comes first, which is the one that opens.
    const listed = JSON.parse((await server.send('GET', '/api/files')).body) as { name: string }[];
    expect(listed.map((file) => file.name)).toEqual(['Elephant.lua', 'Elephant-2020-03-01.lua']);
  });

  it('never overwrites a copy that it kept', async () => {
    await utimes(server.dataFile, noon, noon);
    await add('Elephant.lua', NEWER);
    await utimes(server.dataFile, noon, noon);
    const reply = await add('Elephant.lua', `${NEWER}\r\n`);
    expect(JSON.parse(reply.body)).toMatchObject({ kept: 'Elephant-2020-03-01-2.lua' });
    expect(await readFile(inData('Elephant-2020-03-01.lua'), 'utf8')).toBe(FIXTURE_CRLF);
    expect(await readFile(inData('Elephant-2020-03-01-2.lua'), 'utf8')).toBe(NEWER);
    expect(await readFile(server.dataFile, 'utf8')).toBe(`${NEWER}\r\n`);
  });

  it('keeps each one when two arrive at once', async () => {
    await utimes(server.dataFile, noon, noon);
    const replies = await Promise.all([add('Elephant.lua', NEWER), add('Elephant.lua', `${NEWER}\r\n`)]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    const contents = await Promise.all((await names()).map((name) => readFile(inData(name), 'utf8')));
    expect(contents.sort()).toEqual([FIXTURE_CRLF, NEWER, `${NEWER}\r\n`].sort());
  });

  it('takes another spelling of a name for the same file', async () => {
    const reply = await add('elephant.LUA', NEWER);
    expect(JSON.parse(reply.body)).toMatchObject({ name: 'Elephant.lua', unchanged: false });
    expect((await names()).filter((name) => !name.startsWith('Elephant-'))).toEqual(['Elephant.lua']);
    expect(await readFile(server.dataFile, 'utf8')).toBe(NEWER);
  });

  it.each([
    ['another origin', { origin: 'https://evil.example' }],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['a form post', { 'content-type': 'text/plain' }],
    ['another host', { host: 'evil.example' }],
  ])('refuses %s', async (_name, headers) => {
    expect((await add('StoryLog.lua', STORYLOG_CRLF, headers)).status).toBe(403);
    expect(await names()).toEqual(['Elephant.lua']);
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

  it.each(['/__open-in-editor?file=package.json', '/__OPEN-in-editor.x?file=a', '/__open%2Din-editor?file=a'])(
    'refuses to open an editor through %s',
    async (target) => {
      expect((await server.send('GET', target)).status).toBe(403);
    },
  );

  it.each(['/api/files', '/API/files', '//api/files', '/%61pi/files', '/api/./files', '/x/../api/files'])(
    'never gives API data to another site through %s',
    async (target) => {
      const reply = await server.send('GET', target, undefined, { origin: 'https://evil.example' });
      expect(reply.body).not.toContain('"modified"');
    },
  );

  // package.json and LICENSE stand in for Data/ and .env, which don't exist on every machine.
  it.each([
    [`/@fs/${project}package.json`, '"devDependencies"'],
    [`/@fs/${project}package.json?raw`, 'devDependencies'],
    [`/@fs/${project}package.json?import&raw`, 'devDependencies'],
    [`/@fs/${project}LICENSE?raw??`, 'GNU GENERAL PUBLIC LICENSE'],
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
