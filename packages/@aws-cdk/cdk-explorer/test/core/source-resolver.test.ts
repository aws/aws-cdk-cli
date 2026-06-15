import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SourceMapResolver, isWithinRoot } from '../../lib/core/source-resolver';

const SOURCE_MAPS_DIR = path.join(__dirname, '..', '_fixtures', 'source-maps');
const SAMPLE_JS = path.join(SOURCE_MAPS_DIR, 'sample.js');
const SAMPLE_MAP = path.join(SOURCE_MAPS_DIR, 'sample.js.map');

const tmpDirs: string[] = [];
afterEach(() => {
  tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  tmpDirs.length = 0;
  jest.restoreAllMocks();
});

const tmpDir = (): string => {
  // realpath so the macOS /var -> /private/var symlink doesn't make an existing
  // root and a not-yet-created child disagree under isWithinRoot.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'srcmap-')));
  tmpDirs.push(dir);
  return dir;
};

// sample.js body without its trailing sourceMappingURL comment, so each test
// can attach its own (inline or external) form. greet() stays on line 5.
const sampleBody = (): string =>
  fs.readFileSync(SAMPLE_JS, 'utf-8').replace(/\/\/# sourceMappingURL=.*$/m, '').trimEnd();

// NOTE: choosing WHICH metadata entry's frames to use (LOGICAL_ID.trace vs
// aws:cdk:creationStack) is toolkit-lib's findCreationStackTrace; this resolver
// only turns the chosen frames into a user source location.
describe('SourceMapResolver.resolveFrames', () => {
  // All frames in this block live under /project; the resolver is rooted there.
  let resolver: SourceMapResolver;
  beforeEach(() => {
    resolver = new SourceMapResolver('/project');
  });

  test('returns undefined for no frames', () => {
    expect(resolver.resolveFrames(undefined)).toBeUndefined();
  });

  test('returns undefined when all frames are skip-placeholders', () => {
    // aws-cdk-lib's renderCallStackJustMyCode emits these for filtered frames
    // (e.g. node_modules and node: internals). They have no parens and no
    // :line:col, so they don't match FRAME_RE.
    const frames = [
      '    ...node_modules-aws-cdk-lib...',
      '    ...node internals...',
      '    (no user code in 10 frames, use --stack-trace-limit to capture more)',
    ];
    expect(resolver.resolveFrames(frames)).toBeUndefined();
  });

  test('skips skip-placeholder frames and picks the first parseable user frame', () => {
    const frames = [
      '    ...node_modules-aws-cdk-lib...',
      '    at new MyStack (/project/lib/my-stack.ts:42:7)',
      '    at Object.<anonymous> (/project/bin/app.ts:8:1)',
    ];
    expect(resolver.resolveFrames(frames)).toEqual({
      file: '/project/lib/my-stack.ts',
      line: 42,
      column: 7,
    });
  });

  test('returns undefined for a non-TypeScript (host-language) frame', () => {
    expect(resolver.resolveFrames(['    at <module> (/project/app/my_stack.py:42:5)'])).toBeUndefined();
  });
});

describe('source-map resolution', () => {
  test('resolves .js to .ts using sibling .js.map', () => {
    // sample.js line 5: `function greet(name) {`
    const resolver = new SourceMapResolver(SOURCE_MAPS_DIR);
    const result = resolver.resolveFrames([`    at greet (${SAMPLE_JS}:5:10)`]);
    expect(result).toBeDefined();
    expect(result!.file).toContain('sample.ts');
    expect(result!.line).toBe(2); // ts line 2 = `export function greet`
  });

  test('falls back to .js location when no .js.map exists', () => {
    const dir = tmpDir();
    const jsPath = path.join(dir, 'no-map-here.js');
    const resolver = new SourceMapResolver(dir);
    expect(resolver.resolveFrames([`    at someFn (${jsPath}:1:1)`])).toEqual({
      file: jsPath, line: 1, column: 1,
    });
  });

  test('returns .ts location unchanged (no source-map needed)', () => {
    const resolver = new SourceMapResolver('/project');
    expect(resolver.resolveFrames(['    at someFn (/project/lib/foo.ts:3:2)'])).toEqual({
      file: '/project/lib/foo.ts', line: 3, column: 2,
    });
  });

  test('resolves an inline (data: URI) source map', () => {
    const b64 = Buffer.from(fs.readFileSync(SAMPLE_MAP, 'utf-8'), 'utf-8').toString('base64');
    const dir = tmpDir();
    const jsPath = path.join(dir, 'sample.js');
    fs.writeFileSync(jsPath, `${sampleBody()}\n//# sourceMappingURL=data:application/json;base64,${b64}\n`);

    const resolver = new SourceMapResolver(dir);
    const result = resolver.resolveFrames([`    at greet (${jsPath}:5:10)`]);
    expect(result!.file).toContain('sample.ts');
    expect(result!.line).toBe(2);
  });

  test('resolves an external map referenced under a non-default filename', () => {
    const dir = tmpDir();
    fs.copyFileSync(SAMPLE_MAP, path.join(dir, 'renamed.map'));
    const jsPath = path.join(dir, 'sample.js');
    fs.writeFileSync(jsPath, `${sampleBody()}\n//# sourceMappingURL=renamed.map\n`);

    const resolver = new SourceMapResolver(dir);
    const result = resolver.resolveFrames([`    at greet (${jsPath}:5:10)`]);
    expect(result!.file).toContain('sample.ts');
    expect(result!.line).toBe(2);
  });

  test('applies sourceRoot, resolving sources relative to the map', () => {
    const dir = tmpDir();
    const map = JSON.parse(fs.readFileSync(SAMPLE_MAP, 'utf-8'));
    map.sourceRoot = 'nested/';
    fs.writeFileSync(path.join(dir, 'renamed.map'), JSON.stringify(map));
    const jsPath = path.join(dir, 'sample.js');
    fs.writeFileSync(jsPath, `${sampleBody()}\n//# sourceMappingURL=renamed.map\n`);

    const resolver = new SourceMapResolver(dir);
    const result = resolver.resolveFrames([`    at greet (${jsPath}:5:10)`]);
    expect(result!.file).toBe(path.join(dir, 'nested', 'sample.ts'));
    expect(result!.line).toBe(2);
  });
});

// Paths from the (attacker-influenceable) cloud assembly must never drive a
// read or a navigation target outside the project.
describe('path containment', () => {
  test('drops a frame whose file escapes the project root, without reading it', () => {
    const root = tmpDir();
    const readSpy = jest.spyOn(fs, 'readFileSync');
    const resolver = new SourceMapResolver(root);

    expect(resolver.resolveFrames(['    at evil (/etc/passwd.js:1:1)'])).toBeUndefined();
    // The escaping path must be rejected before any read of it.
    expect(readSpy.mock.calls.some(([p]) => String(p).includes('/etc/passwd'))).toBe(false);
  });

  test('drops a .ts frame that escapes the project root', () => {
    const root = tmpDir();
    const resolver = new SourceMapResolver(root);
    expect(resolver.resolveFrames([`    at f (${path.join(root, '..', 'outside.ts')}:1:1)`])).toBeUndefined();
  });

  test('ignores an external source map that escapes the root, falling back to the .js', () => {
    const dir = tmpDir();
    const jsPath = path.join(dir, 'sample.js');
    // In-root .js, but its sourceMappingURL points outside the project.
    fs.writeFileSync(jsPath, `${sampleBody()}\n//# sourceMappingURL=../../../../etc/evil.map\n`);
    const readSpy = jest.spyOn(fs, 'readFileSync');

    const resolver = new SourceMapResolver(dir);
    const result = resolver.resolveFrames([`    at greet (${jsPath}:5:10)`]);

    // Falls back to the (in-root) .js location; the escaping map is never read.
    expect(result).toEqual({ file: jsPath, line: 5, column: 10 });
    expect(readSpy.mock.calls.some(([p]) => String(p).includes('etc/evil.map'))).toBe(false);
    expect(resolver.warnings.join('\n')).toMatch(/escapes the project root/);
  });

  test('falls back to the .js when the mapped original resolves outside the root', () => {
    const dir = tmpDir();
    const map = JSON.parse(fs.readFileSync(SAMPLE_MAP, 'utf-8'));
    map.sourceRoot = '../../../../../../etc/'; // pushes sample.ts outside the root
    fs.writeFileSync(path.join(dir, 'renamed.map'), JSON.stringify(map));
    const jsPath = path.join(dir, 'sample.js');
    fs.writeFileSync(jsPath, `${sampleBody()}\n//# sourceMappingURL=renamed.map\n`);

    const resolver = new SourceMapResolver(dir);
    const result = resolver.resolveFrames([`    at greet (${jsPath}:5:10)`]);
    expect(result).toEqual({ file: jsPath, line: 5, column: 10 });
  });
});

describe('isWithinRoot', () => {
  const root = path.resolve('/srv/app');

  test('accepts a path inside the root', () => {
    expect(isWithinRoot(root, path.join(root, 'lib/stack.ts'))).toBe(true);
  });

  test('accepts the root itself', () => {
    expect(isWithinRoot(root, root)).toBe(true);
  });

  test('rejects traversal above the root', () => {
    expect(isWithinRoot(root, path.join(root, '../../etc/passwd'))).toBe(false);
  });

  test('accepts traversal that stays within the root', () => {
    expect(isWithinRoot(root, path.join(root, 'lib/../bin/cdk.ts'))).toBe(true);
  });

  test('does not treat a sibling dir with a shared prefix as inside', () => {
    expect(isWithinRoot(root, path.resolve('/srv/app-secrets/file'))).toBe(false);
  });

  test('rejects a target reached through a symlink that points outside the root', () => {
    const root2 = tmpDir();
    const outside = tmpDir();
    fs.writeFileSync(path.join(outside, 'secret.ts'), 'secret');
    fs.symlinkSync(outside, path.join(root2, 'link'));
    // Lexically inside root2, but realpath lands in `outside`.
    expect(isWithinRoot(root2, path.join(root2, 'link', 'secret.ts'))).toBe(false);
  });
});
