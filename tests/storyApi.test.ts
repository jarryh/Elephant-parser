/** The real SDK against a fake Claude API on localhost. These never spend credit. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryEvent } from '../src/shared/api';
import { DEFAULT_OPTIONS } from '../src/shared/story';
import { startServer, type TestServer } from './serverHelper';

interface Received {
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

interface Script {
  status?: number;
  stop?: string;
  fallbackTo?: string;
  /** Served by the fallback model because an earlier request fell back. */
  sticky?: boolean;
  hang?: boolean;
  parts?: string[];
}

const KEY = 'test-key-not-real';
const BODY = { transcript: '20:03 [Say] Borin Fixture: Well met.', options: DEFAULT_OPTIONS };

let claude: Server;
let received: Received[];
let script: Script;
let disconnected: boolean;
let server: TestServer;

beforeEach(async () => {
  received = [];
  script = {};
  disconnected = false;

  claude = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    received.push({ url: req.url!, headers: req.headers, body });

    if (script.status) {
      res.writeHead(script.status, { 'content-type': 'application/json', 'x-should-retry': 'false' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'error', message: 'fake failure' } }));
      return;
    }
    if (req.url!.includes('count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ input_tokens: 1234 }));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.on('close', () => {
      if (!res.writableEnded) disconnected = true;
    });
    const event = (type: string, data: object) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);

    event('message_start', {
      message: {
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model: script.sticky ? 'fallback-model' : body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 1 },
      },
    });

    let index = 0;
    if (script.fallbackTo) {
      event('content_block_start', {
        index,
        content_block: { type: 'fallback', from: { model: body.model }, to: { model: script.fallbackTo } },
      });
      event('content_block_stop', { index });
      index++;
    }
    event('content_block_start', { index, content_block: { type: 'text', text: '' } });
    for (const text of script.parts ?? ['# The Žluťoučký Gate\n\n', 'Borin bowed. 🐘']) {
      event('content_block_delta', { index, delta: { type: 'text_delta', text } });
    }
    if (script.hang) return;

    event('content_block_stop', { index });
    event('message_delta', {
      delta: { stop_reason: script.stop ?? 'end_turn', stop_sequence: null },
      usage: {
        output_tokens: 42,
        ...(script.sticky && {
          iterations: [{ type: 'fallback_message', model: 'fallback-model', input_tokens: 100, output_tokens: 42 }],
        }),
      },
    });
    event('message_stop', {});
    res.end();
  });
  await new Promise<void>((resolve) => claude.listen(0, '127.0.0.1', resolve));

  server = await startServer({ anthropicBaseURL: `http://127.0.0.1:${(claude.address() as AddressInfo).port}` });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await server.close();
  claude.closeAllConnections();
  await new Promise((resolve) => claude.close(resolve));
});

const env = (text: string) => writeFile(path.join(server.dir, '.env'), text);
const withKey = () => env(`ANTHROPIC_API_KEY=${KEY}\n`);

async function write(): Promise<StoryEvent[]> {
  const reply = await server.send('POST', '/api/story', BODY);
  return reply.body
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as StoryEvent);
}

describe('without a key', () => {
  it('reports that stories are off and sends nothing', async () => {
    expect(JSON.parse((await server.send('GET', '/api/config')).body)).toEqual({ story: null });
    expect((await server.send('POST', '/api/story', BODY)).status).toBe(403);
    expect((await server.send('POST', '/api/story/tokens', BODY)).status).toBe(403);
    expect(received).toEqual([]);
  });

  it('treats an empty value as no key', async () => {
    await env('ANTHROPIC_API_KEY=\n');
    expect(JSON.parse((await server.send('GET', '/api/config')).body)).toEqual({ story: null });
  });

  it('ignores a key in the system environment', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'from-environment');
    expect((await server.send('POST', '/api/story', BODY)).status).toBe(403);
    expect(received).toEqual([]);
  });
});

describe('with a key', () => {
  beforeEach(withKey);

  it('shows the model, never the key', async () => {
    const reply = await server.send('GET', '/api/config');
    expect(JSON.parse(reply.body)).toEqual({ story: { model: 'claude-opus-5-5' } });
    expect(reply.body).not.toContain(KEY);
  });

  it('counts tokens without writing a story', async () => {
    const reply = await server.send('POST', '/api/story/tokens', BODY);
    expect(JSON.parse(reply.body)).toEqual({ inputTokens: 1234 });
    expect(received.map((request) => request.url.split('?')[0])).toEqual(['/v1/messages/count_tokens']);
  });

  it('streams a story and saves it as Markdown', async () => {
    const events = await write();
    expect(events.map((event) => event.type)).toEqual(['text', 'text', 'done']);
    const done = events.at(-1);
    expect(done).toMatchObject({
      text: '# The Žluťoučký Gate\n\nBorin bowed. 🐘',
      inputTokens: 100,
      outputTokens: 42,
      truncated: false,
      fellBack: false,
    });

    const dir = path.join(server.dir, 'workspace', 'stories');
    const [file] = await readdir(dir);
    expect(done).toMatchObject({ savedTo: `workspace/stories/${file}` });
    expect(await readFile(path.join(dir, file!), 'utf8')).toBe('# The Žluťoučký Gate\n\nBorin bowed. 🐘\n');
  });

  it('sends a request the current API accepts', async () => {
    await write();
    const { headers, body } = received[0]!;
    // SDK 1.x sends API keys as Bearer tokens.
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      stream: true,
      max_tokens: 20_000,
      output_config: { effort: 'medium' },
      fallbacks: 'default',
    });
    for (const rejected of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) {
      expect(body).not.toHaveProperty(rejected);
    }
    expect(JSON.stringify(body.messages)).toContain('Well met.');
  });

  it('uses the key from .env over other credentials', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'from-environment');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token-from-environment');
    await write();
    expect(received[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(received[0]!.headers)).not.toContain('from-environment');
  });

  it('uses the model from .env, without settings it may not support', async () => {
    await env(`ANTHROPIC_API_KEY=${KEY}\nANTHROPIC_MODEL=some-other-model\n`);
    await write();
    expect(received[0]!.body.model).toBe('some-other-model');
    expect(received[0]!.body).not.toHaveProperty('fallbacks');
    expect(received[0]!.body).not.toHaveProperty('output_config');
  });

  it('reports a fallback to another model', async () => {
    script.fallbackTo = 'fallback-model';
    expect((await write()).at(-1)).toMatchObject({ type: 'done', model: 'fallback-model', fellBack: true });
  });

  it('reports a fallback model that answers directly, after an earlier fallback', async () => {
    script.sticky = true;
    expect((await write()).at(-1)).toMatchObject({ type: 'done', model: 'fallback-model', fellBack: true });
  });

  it('flags a story that was cut off', async () => {
    script.stop = 'max_tokens';
    expect((await write()).at(-1)).toMatchObject({ type: 'done', truncated: true });
  });

  it('reports a refusal, and saves nothing', async () => {
    script.stop = 'refusal';
    script.parts = [];
    const [event] = await write();
    expect(event).toMatchObject({ type: 'error', message: expect.stringContaining('declined') });
    await expect(readdir(path.join(server.dir, 'workspace', 'stories'))).rejects.toThrow();
  });

  it.each([
    [400, 'rejected the request'],
    [401, 'key was rejected'],
    [403, 'not allowed'],
    [404, 'was not found'],
    [429, 'rate limit'],
    [500, 'has a problem'],
  ])('explains an API %i without leaking the key', async (status, message) => {
    script.status = status;
    const reply = await server.send('POST', '/api/story', BODY);
    expect(reply.body).toContain(message);
    expect(reply.body).not.toContain(KEY);
  });

  it('rejects an invalid request before calling the API', async () => {
    expect((await server.send('POST', '/api/story', { ...BODY, transcript: ' ' })).status).toBe(400);
    expect((await server.send('POST', '/api/story', { transcript: 'x' })).status).toBe(400);
    expect(received).toEqual([]);
  });

  it('cannot be triggered by another website', async () => {
    const reply = await server.send('POST', '/api/story', BODY, { origin: 'https://evil.example' });
    expect(reply.status).toBe(403);
    expect(received).toEqual([]);
  });

  it('stops the API request when the browser stops listening', async () => {
    script.hang = true;
    const controller = new AbortController();
    const response = await fetch(`${server.url}/api/story`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify(BODY),
      signal: controller.signal,
    });
    await response.body!.getReader().read();
    controller.abort();
    await vi.waitFor(() => expect(disconnected).toBe(true), { timeout: 5000 });
  });
});
