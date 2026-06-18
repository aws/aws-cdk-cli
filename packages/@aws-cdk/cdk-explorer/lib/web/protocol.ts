/** HTTP contract shared between the web server and the SPA. Types only. */

export interface DirEntry {
  readonly name: string;
  /** Path relative to the app directory, usable as the next `dir`/`path` value. POSIX separators. */
  readonly path: string;
  readonly type: 'dir' | 'file';
}

export interface FilesResponse {
  readonly dir: string;
  readonly entries: readonly DirEntry[];
}

export interface FileResponse {
  readonly path: string;
  readonly content: string;
}
