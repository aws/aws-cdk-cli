import type { DirEntry, FilesResponse, FileResponse } from '../lib/web/protocol';

export type { DirEntry, FilesResponse, FileResponse };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listFiles: (dir = ''): Promise<FilesResponse> => getJson(`/api/files?dir=${encodeURIComponent(dir)}`),
  readFile: (filePath: string): Promise<FileResponse> => getJson(`/api/file?path=${encodeURIComponent(filePath)}`),
};
