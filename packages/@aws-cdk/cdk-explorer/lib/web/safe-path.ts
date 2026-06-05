import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve a client-supplied, root-relative path to an absolute path guaranteed
 * to stay inside `root`. Returns `undefined` when the request escapes the root
 * (via `..` or a symlink pointing outside), which callers must treat as a 403.
 *
 * `root` is expected to be absolute. A leading `/` on `requested` is stripped so
 * absolute-looking inputs cannot jump to the filesystem root.
 */
export function resolveWithinRoot(root: string, requested: string): string | undefined {
  const realRoot = realOrSelf(path.resolve(root));
  const relative = requested.replace(/^[/\\]+/, '');
  const resolved = path.resolve(realRoot, relative);

  if (!isInside(realRoot, resolved)) {
    return undefined;
  }
  // Follow symlinks on the target: an existing file reached through a symlinked
  // directory must still land inside the root. A non-existent target resolves to
  // itself and stays caught by the lexical check above (and the caller 404s it).
  if (!isInside(realRoot, realOrSelf(resolved))) {
    return undefined;
  }
  return resolved;
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/** Real path with symlinks resolved, or the input unchanged if it does not exist. */
function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}
