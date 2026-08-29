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
 * True when a root-relative path names something the explorer refuses to
 * display. Containment answers "does this path stay inside the root?"; this
 * answers "should the root expose it at all?" — the served roots are broad by
 * nature (`appDir` is the whole project tree, the assembly dir holds staged
 * assets), so containment alone still leaves credentials in reach of an
 * unauthenticated read.
 *
 * The broad rule is that any dot-prefixed segment is out of scope: `.env`,
 * `.git/config`, `.ssh/id_rsa`, `.aws/credentials`, `.npmrc`, `.netrc`. That is
 * the policy the source watcher already applies (`SOURCE_WATCH_EXCLUDES`
 * excludes `.*`), and nothing the explorer displays is a dotfile — a CDK app's
 * source files and templates never are. The name and extension lists then cover
 * the secret-bearing files that are not dotfiles.
 *
 * The path must be relative to the served root: an absolute path would trip the
 * dotfile rule on the root's own location (e.g. a project under `~/.local`).
 */
export function isSensitivePath(relPath: string): boolean {
  const segments = relPath.split(/[/\\]+/).filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment.startsWith('.'))) {
    return true;
  }
  const basename = (segments[segments.length - 1] ?? '').toLowerCase();
  return SENSITIVE_BASENAMES.has(basename) || SENSITIVE_EXTENSIONS.has(path.extname(basename));
}

/**
 * True when `resolved` — an absolute path {@link resolveWithinRoot} already
 * confined to `root` — is denied by {@link isSensitivePath}. The symlink target
 * is checked too, so a link with an innocuous name (`src/config.ts` pointing at
 * `.env`) cannot launder a denied one; containment already guarantees the target
 * is inside the root, so this only re-runs the name policy on it.
 */
export function isSensitiveRead(root: string, resolved: string): boolean {
  // Relativize against the same canonical root resolveWithinRoot resolved against,
  // or a symlinked root (macOS `/var`) would yield a `..`-prefixed relative path
  // and deny every read.
  const realRoot = realOrSelf(path.resolve(root));
  if (isSensitivePath(path.relative(realRoot, resolved))) {
    return true;
  }
  const real = realOrSelf(resolved);
  return real !== resolved && isSensitivePath(path.relative(realRoot, real));
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
