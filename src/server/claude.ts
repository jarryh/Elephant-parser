import Anthropic from '@anthropic-ai/sdk';
import type { StoryRequest } from '../shared/api';
import { buildPrompt, DEFAULT_MODEL, LENGTHS, modelInfo } from '../shared/story';
import { readEnv } from './env';

export interface StorySettings {
  apiKey: string;
  model: string;
}

/** Only .env counts. A key that happens to be in the system environment is never used. */
export function storySettings(envFile: string): StorySettings | null {
  const env = readEnv(envFile);
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL };
}

export function createClient(settings: StorySettings, baseURL = 'https://api.anthropic.com'): Anthropic {
  // All explicit, so that the environment can't swap the credentials or the destination.
  return new Anthropic({ apiKey: settings.apiKey, authToken: null, baseURL });
}

export async function countTokens(client: Anthropic, model: string, request: StoryRequest): Promise<number> {
  const { system, user } = buildPrompt(request.transcript, request.options);
  const count = await client.messages.countTokens({ model, system, messages: [{ role: 'user', content: user }] });
  return count.input_tokens;
}

export function streamStory(client: Anthropic, model: string, request: StoryRequest, signal: AbortSignal) {
  const { system, user } = buildPrompt(request.transcript, request.options);
  const known = modelInfo(model);

  return client.beta.messages.stream(
    {
      model,
      max_tokens: LENGTHS[request.options.length].maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      // Unknown models may reject these two.
      ...(known && { output_config: { effort: 'medium' as const } }),
      // If a safety check declines (violent RP can trigger one), another model takes over.
      ...(known?.fallbacks && {
        betas: ['server-side-fallback-2026-07-01' as const],
        fallbacks: 'default' as const,
      }),
    },
    { signal },
  );
}

export function describeApiError(error: unknown, model: string): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'The API key was rejected. Check ANTHROPIC_API_KEY in .env.';
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return `This API key is not allowed to use ${model}.`;
  }
  if (error instanceof Anthropic.NotFoundError) {
    return `The model "${model}" was not found. Check ANTHROPIC_MODEL in .env.`;
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'The API rate limit was reached. Wait a minute and try again.';
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `The API rejected the request: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Claude API. Check your internet connection.';
  }
  if (error instanceof Anthropic.InternalServerError) {
    return 'The Claude API has a problem right now. Try again shortly.';
  }
  if (error instanceof Anthropic.APIError) {
    return `The Claude API returned an error: ${error.message}`;
  }
  console.error(error);
  return 'The story failed unexpectedly. Details are in the terminal.';
}
