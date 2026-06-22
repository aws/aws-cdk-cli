import {
  ASSEMBLY_CHANGED,
  type DirEntry,
  type FilesResponse,
  type FileResponse,
  type TreeResponse,
  type ViolationsResponse,
  type WebConstructNode,
  type WebViolation,
  type WebViolationOccurrence,
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
  /**
   * Subscribe to assembly-changed events from the server, invoking `onChange`
   * whenever the cloud assembly is rewritten. Returns an unsubscribe that closes
   * the underlying EventSource.
   */
  subscribe: (onChange: () => void): (() => void) => {
    const source = new EventSource('/api/events');
    source.addEventListener(ASSEMBLY_CHANGED, () => onChange());
    return () => source.close();
  },
};
