import {
  ASSEMBLY_CHANGED,
  SOURCE_CHANGED,
  type FileResponse,
  type LineRange,
  type TemplateResource,
  type TemplateResponse,
  type TreeResponse,
  type ViolationsResponse,
  type WebConstructNode,
  type WebSourceLocation,
  type WebViolation,
  type WebViolationOccurrence,
} from '../lib/web/protocol';

export type {
  FileResponse,
  LineRange,
  TemplateResource,
  TemplateResponse,
  TreeResponse,
  ViolationsResponse,
  WebConstructNode,
  WebSourceLocation,
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
  readFile: (filePath: string): Promise<FileResponse> => getJson(`/api/file?path=${encodeURIComponent(filePath)}`),
  getTree: (): Promise<TreeResponse> => getJson('/api/tree'),
  getViolations: (): Promise<ViolationsResponse> => getJson('/api/policy-validation'),
  getAppInfo: (): Promise<AppInfoResponse> => getJson('/api/info'),
  /**
   * Subscribe to the server's live-refresh stream. `onAssemblyChanged` fires
   * when the cloud assembly is rewritten (re-fetch tree/violations);
   * `onSourceChanged` fires when a source file is edited (re-check the open
   * file's staleness). Returns an unsubscribe that closes the EventSource.
   */
  subscribe: (handlers: { onAssemblyChanged?: () => void; onSourceChanged?: () => void }): (() => void) => {
    const source = new EventSource('/api/events');
    if (handlers.onAssemblyChanged) {
      source.addEventListener(ASSEMBLY_CHANGED, () => handlers.onAssemblyChanged!());
    }
    if (handlers.onSourceChanged) {
      source.addEventListener(SOURCE_CHANGED, () => handlers.onSourceChanged!());
    }
    return () => source.close();
  },
  getTemplate: (file: string): Promise<TemplateResponse> => getJson(`/api/template?file=${encodeURIComponent(file)}`),
};
