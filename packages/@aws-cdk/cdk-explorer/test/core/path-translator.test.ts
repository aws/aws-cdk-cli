import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PathTranslator } from '../../lib/core/assembly-index-with-source-locations';

/**
 * `PathTranslator` converts between the app/assembly-relative paths the wire
 * formats use and the absolute paths the filesystem needs, and bounds both to
 * its root directory.
 *
 * `contains()` is a security boundary: it gates `onDefinition`'s read of a
 * client-supplied template path, and the source-map loader's read of an
 * assembly-supplied `sourceMappingURL`. Both inputs are attacker-influenceable
 * if `cdk.out` is tampered with.
 */
let root: string;
let outside: string;

beforeEach(() => {
  // realpath: on macOS os.tmpdir() is a symlink, and contains() compares
  // against the realpath of its input, so the root must already be resolved.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-root-')));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-outside-')));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

const translator = () => new PathTranslator(root);

describe('relative', () => {
  test('makes an absolute path inside the root relative to it', () => {
    expect(translator().relative(path.join(root, 'lib', 'stack.ts'))).toBe('lib/stack.ts');
  });

  test('leaves an already-relative path alone', () => {
    expect(translator().relative('lib/stack.ts')).toBe('lib/stack.ts');
  });

  test('normalizes to POSIX separators so the wire format is platform-stable', () => {
    expect(translator().relative(path.join(root, 'lib', 'nested', 'deep.ts'))).toBe('lib/nested/deep.ts');
  });

  test('maps the root itself to the empty path', () => {
    expect(translator().relative(root)).toBe('');
  });

  test('replaces a path escaping the root with a contained sentinel', () => {
    // Deliberate: rather than emit a '../' path that a consumer would resolve
    // outside the project, the escape is made visible and harmless.
    expect(translator().relative(path.join(outside, 'other.ts'))).toBe('ESCAPING');
  });
});

describe('absolute', () => {
  test('round-trips a path inside the root', () => {
    const original = path.join(root, 'lib', 'stack.ts');
    const translated = translator();

    expect(translated.absolute(translated.relative(original))).toBe(original);
  });
});

describe('contains', () => {
  test('accepts an absolute path inside the root', async () => {
    expect(await translator().contains(path.join(root, 'sub', 'file.map'))).toBe(true);
  });

  test('accepts the root itself', async () => {
    expect(await translator().contains(root)).toBe(true);
  });

  test('rejects an absolute path outside the root', async () => {
    expect(await translator().contains(path.join(outside, 'secret.map'))).toBe(false);
  });

  test('rejects a sibling directory that merely shares the root prefix', async () => {
    // `/root-evil` must not pass as `/root`; the check is path-segment aware,
    // not a bare string prefix.
    expect(await translator().contains(`${root}-evil/file.map`)).toBe(false);
  });

  test('rejects a symlink inside the root that points outside it', async () => {
    fs.writeFileSync(path.join(outside, 'secret.map'), '{}');
    const link = path.join(root, 'link.map');
    try {
      fs.symlinkSync(path.join(outside, 'secret.map'), link);
    } catch {
      return; // symlinks not permitted in this environment
    }

    // Resolved before comparing, so a planted link cannot smuggle a read out.
    expect(await translator().contains(link)).toBe(false);
  });

  test('rejects a relative path that traverses out of the root', async () => {
    // A relative path is interpreted against the root, so whether it stays
    // inside depends on its content -- '../' walks out and must be refused just
    // as the equivalent absolute path is.
    expect(await translator().contains(path.join('..', path.basename(outside), 'secret.map'))).toBe(false);
  });

  test('accepts a relative path that stays within the root', async () => {
    expect(await translator().contains(path.join('lib', 'stack.ts'))).toBe(true);
  });
});
