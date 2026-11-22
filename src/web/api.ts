import type { DataFile, LoadedFile } from '../shared/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request(url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(0, 'Cannot reach the local server. Is "npm run dev" still running?');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, body?.error ?? `The server answered with ${response.status}.`);
  }
  return response;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return (await request(url, { signal })).json() as Promise<T>;
}

export const fileUrl = (name: string) => `/api/files/${encodeURIComponent(name)}`;

export const api = {
  files: (signal?: AbortSignal) => getJson<DataFile[]>('/api/files', signal),
  load: (name: string, signal?: AbortSignal) => getJson<LoadedFile>(fileUrl(name), signal),
};
