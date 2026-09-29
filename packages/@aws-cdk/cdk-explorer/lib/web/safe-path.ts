import * as fs from 'fs';
import * as path from 'path';

export interface WorkspacePath {
  readonly root: string;
  readonly absolutePath: string;
  readonly relativePath: string;
}

export function mkWorkspacePath(root: string, relativeRequested: string): WorkspacePath {
  const realRoot = realPath(path.resolve(root));

  const absolutePath = path.resolve(realRoot, relativeRequested);
  return {
    root: realRoot,
    absolutePath,
    relativePath: path.relative(realRoot, absolutePath),
  };
}

/**
 * Resolve a client-supplied, root-relative path to an absolute path guaranteed
 * to stay inside `root`.
 *
 * Returns `undefined` when the request escapes the root (via `..` or a symlink
 * pointing outside), which callers must treat as a 403.
 *
 */
export function resolveWithinRoot(root: string, relativeRequested: string): WorkspacePath | undefined {
  const requested = mkWorkspacePath(root, relativeRequested);

  // Only resolve potential symlinks if the symlink is in the target directory
  if (escapesRoot(requested)) {
    return undefined;
  }

  // Resolve a potential symlink, should still stay inside the target directory
  const followed = resolveSymlink(requested);
  if (escapesRoot(followed)) {
    return undefined;
  }

  return followed;
}

function escapesRoot(ws: WorkspacePath): boolean {
  return ws.absolutePath !== ws.root && !ws.absolutePath.startsWith(ws.root + path.sep);
}

/**
 * Real path with symlinks resolved, or the input unchanged if it does not exist.
 *
 * Also makes relative symlinks absolute.
 */
function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function resolveSymlink(ws: WorkspacePath): WorkspacePath {
  const p = realPath(ws.absolutePath);
  return {
    root: ws.root,
    absolutePath: p,
    relativePath: path.relative(ws.root, p),
  };
}

/**
 * File names that carry secrets often enough to refuse by name. Extension-less,
 * so the dotfile rule in {@link isSensitivePath} does not already cover them.
 */
const SENSITIVE_BASENAMES = new Set([
  'credentials',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);

/** Extensions that only ever hold key material. */
const SENSITIVE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.ppk',
  '.asc',
  '.gpg',
  '.kdbx',
]);

/** Extensions `/api/template` will serve. CDK writes templates as JSON. */
const TEMPLATE_EXTENSIONS = new Set(['.json', '.yaml', '.yml']);

/**
 * True if the requested file is marked as "sensitive" and will never be allowed to be read
 */
export function isSensitiveRead(wsPath: WorkspacePath): boolean {
  return wsPath
    .relativePath
    .split(/[/\\]+/)
    .filter((segment) => segment.length > 0)
    .some((segment) => segment.startsWith('.') || SENSITIVE_BASENAMES.has(segment.toLowerCase()) || SENSITIVE_EXTENSIONS.has(path.extname(segment).toLowerCase()));
}

/**
 * True when a root-relative path looks like a CloudFormation template.
 * `/api/template` serves from the cloud assembly, which also holds staged asset
 * bundles (a Lambda bundle carries whatever its author shipped), so the endpoint
 * is restricted to the file types it exists to render.
 */
export function isTemplatePath(relPath: string): boolean {
  return TEMPLATE_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}
