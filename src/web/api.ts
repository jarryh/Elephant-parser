import type { AppConfig, DataFile, LoadedFile } from '../shared/api';
import type { Workspace } from '../shared/workspace';

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
  config: () => getJson<AppConfig>('/api/config'),
  files: (signal?: AbortSignal) => getJson<DataFile[]>('/api/files', signal),
  load: (name: string, signal?: AbortSignal) => getJson<LoadedFile>(fileUrl(name), signal),
  workspace: (name: string, signal?: AbortSignal) => getJson<Workspace>(`${fileUrl(name)}/workspace`, signal),
  async saveWorkspace(name: string, workspace: Workspace): Promise<number> {
    const response = await request(`${fileUrl(name)}/workspace`, { method: 'PUT', body: JSON.stringify(workspace) });
    return ((await response.json()) as { revision: number }).revision;
  },
};
