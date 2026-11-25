import type { StoryEvent, StoryRequest, StoryResult } from '../shared/api';
import { ApiError, request } from './api';

export async function countStoryTokens(body: StoryRequest, signal: AbortSignal): Promise<number> {
  const response = await request('/api/story/tokens', { method: 'POST', body: JSON.stringify(body), signal });
  return ((await response.json()) as { inputTokens: number }).inputTokens;
}

/** Calls `onText` as the story arrives, and resolves when it's finished. */
export async function generateStory(
  body: StoryRequest,
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<StoryResult> {
  const response = await request('/api/story', { method: 'POST', body: JSON.stringify(body), signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const event = JSON.parse(buffer.slice(0, newline)) as StoryEvent;
      buffer = buffer.slice(newline + 1);
      if (event.type === 'text') onText(event.text);
      else if (event.type === 'error') throw new ApiError(502, event.message);
      else return event;
    }
  }
  throw new ApiError(0, 'The connection closed before the story was finished.');
}
