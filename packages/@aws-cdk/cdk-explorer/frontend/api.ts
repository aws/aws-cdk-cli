import type {
  DirEntry,
  FilesResponse,
  FileResponse,
  TreeResponse,
  ViolationsResponse,
  WebConstructNode,
  WebViolation,
  WebViolationOccurrence,
} from '../lib/web/protocol';

export type {
  DirEntry,
  FilesResponse,
  FileResponse,
  TreeResponse,
  ViolationsResponse,
  WebConstructNode,
  WebViolation,
  WebViolationOccurrence,
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface AppInfoResponse {
  readonly appDir: string;
}

export const api = {
  listFiles: (dir = ''): Promise<FilesResponse> => getJson(`/api/files?dir=${encodeURIComponent(dir)}`),
  readFile: (filePath: string): Promise<FileResponse> => getJson(`/api/file?path=${encodeURIComponent(filePath)}`),
  getTree: (): Promise<TreeResponse> => getJson('/api/tree'),
  getViolations: (): Promise<ViolationsResponse> => getJson('/api/policy-validation'),
  getAppInfo: (): Promise<AppInfoResponse> => getJson('/api/info'),
};
