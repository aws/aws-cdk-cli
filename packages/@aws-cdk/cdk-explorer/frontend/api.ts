import {
  ASSEMBLY_CHANGED,
  SYNTH_STATUS,
  type DirEntry,
  type FilesResponse,
  type FileResponse,
  type LineRange,
  type SynthStatusEvent,
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
  DirEntry,
  FilesResponse,
  FileResponse,
  LineRange,
  SynthStatusEvent,
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

async function sendJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error ?? `request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface AppInfoResponse {
  readonly appDir: string;
}

export interface SynthResult {
  readonly status: 'success' | 'app-failure' | 'lock-conflict' | 'unavailable' | 'error';
  readonly message?: string;
  readonly details?: string;
}

export const api = {
  listFiles: (dir = ''): Promise<FilesResponse> => getJson(`/api/files?dir=${encodeURIComponent(dir)}`),
  readFile: (filePath: string): Promise<FileResponse> => getJson(`/api/file?path=${encodeURIComponent(filePath)}`),
  getTree: (): Promise<TreeResponse> => getJson('/api/tree'),
  getViolations: (): Promise<ViolationsResponse> => getJson('/api/policy-validation'),
  getAppInfo: (): Promise<AppInfoResponse> => getJson('/api/info'),
  getAutoSynth: (): Promise<{ enabled: boolean }> => getJson('/api/synth/auto'),
  setAutoSynth: (enabled: boolean): Promise<{ enabled: boolean }> => sendJson('/api/synth/auto', { enabled }),
  synth: async (): Promise<SynthResult> => {
    return sendJson<SynthResult>('/api/synth');
  },
  /**
   * Subscribe to server-sent events on one EventSource. `onAssemblyChanged`
   * fires when the cloud assembly is rewritten (re-fetch); the optional
   * `onSynthFailure` fires with a failed synth's summary + stderr. Returns an
   * unsubscribe that closes the stream.
   */
  subscribe: (handlers: {
    onAssemblyChanged: () => void;
    onSynthFailure?: (event: SynthStatusEvent) => void;
  }): (() => void) => {
    const source = new EventSource('/api/events');
    source.addEventListener(ASSEMBLY_CHANGED, () => handlers.onAssemblyChanged());
    if (handlers.onSynthFailure) {
      source.addEventListener(SYNTH_STATUS, (ev) => handlers.onSynthFailure!(JSON.parse((ev as MessageEvent).data) as SynthStatusEvent));
    }
    return () => source.close();
  },
  getTemplate: (file: string): Promise<TemplateResponse> => getJson(`/api/template?file=${encodeURIComponent(file)}`),
};
