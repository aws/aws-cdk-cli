import {
  ASSEMBLY_CHANGED,
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
   * Subscribe to assembly-changed events from the server, invoking `onChange`
   * whenever the cloud assembly is rewritten. Returns an unsubscribe that closes
   * the underlying EventSource.
   */
  subscribe: (onChange: () => void): (() => void) => {
    const source = new EventSource('/api/events');
    source.addEventListener(ASSEMBLY_CHANGED, () => onChange());
    return () => source.close();
  },
  getTemplate: (file: string): Promise<TemplateResponse> => getJson(`/api/template?file=${encodeURIComponent(file)}`),
};
