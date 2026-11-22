import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Request, Router } from 'express';
import type { AppConfig, StoryEvent, StoryRequest } from '../shared/api';
import { parseOptions } from '../shared/story';
import { atomicWrite } from './atomicWrite';
import { countTokens, createClient, describeApiError, storySettings, streamStory } from './claude';
import { HttpError } from './errors';

interface Options {
  envFile: string;
  storiesDir: string;
  anthropicBaseURL?: string;
}

export function addStoryRoutes(api: Router, { envFile, storiesDir, anthropicBaseURL }: Options): void {
  const prepare = (req: Request) => {
    const settings = storySettings(envFile);
    if (!settings) throw new HttpError(403, 'There is no ANTHROPIC_API_KEY in .env.');
    const request = parseRequest(req.body);
    if (!request) throw new HttpError(400, 'The story request is empty or invalid.');
    return { model: settings.model, request, client: createClient(settings, anthropicBaseURL) };
  };

  api.get('/config', (_req, res) => {
    const settings = storySettings(envFile);
    const config: AppConfig = { story: settings && { model: settings.model } };
    res.json(config);
  });

  api.post('/story/tokens', async (req, res) => {
    const { model, request, client } = prepare(req);
    try {
      res.json({ inputTokens: await countTokens(client, model, request) });
    } catch (error) {
      throw new HttpError(502, describeApiError(error, model));
    }
  });

  api.post('/story', async (req, res) => {
    const { model, request, client } = prepare(req);

    const controller = new AbortController();
    // Stop paying for a story when the browser stops listening.
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const send = (event: StoryEvent) => {
      if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
    };

    res.status(200).type('application/x-ndjson');
    res.flushHeaders();

    try {
      const stream = streamStory(client, model, request, controller.signal);
      stream.on('text', (text) => send({ type: 'text', text }));
      const message = await stream.finalMessage();
      const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');

      if (message.stop_reason === 'refusal') {
        send({ type: 'error', message: 'Claude declined to write this. Try a smaller or different selection.' });
      } else if (message.stop_reason === 'model_context_window_exceeded' && !text) {
        send({ type: 'error', message: 'The selection is too long for this model. Choose a shorter period.' });
      } else if (!text.trim()) {
        send({ type: 'error', message: 'Claude returned no text.' });
      } else {
        send({
          type: 'done',
          text,
          savedTo: await save(storiesDir, text),
          model: message.model,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          truncated: message.stop_reason !== 'end_turn',
          fellBack: message.content.some((block) => block.type === 'fallback'),
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) send({ type: 'error', message: describeApiError(error, model) });
    }
    res.end();
  });
}

function parseRequest(body: unknown): StoryRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { transcript, options } = body as Record<string, unknown>;
  const parsed = parseOptions(options);
  if (typeof transcript !== 'string' || !transcript.trim() || !parsed) return null;
  return { transcript, options: parsed };
}

async function save(dir: string, text: string): Promise<string | null> {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-');
  const name = `${stamp}_${randomUUID().slice(0, 8)}.md`;
  try {
    await atomicWrite(path.join(dir, name), `${text.trim()}\n`);
    return `workspace/stories/${name}`;
  } catch (error) {
    // The browser still gets the text, so don't fail a story that was paid for.
    console.error('Could not save the story:', error);
    return null;
  }
}
