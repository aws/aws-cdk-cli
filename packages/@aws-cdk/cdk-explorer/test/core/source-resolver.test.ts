import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SourceMapResolver } from '../../lib/core/source-resolver';

const SOURCE_MAPS_DIR = path.join(__dirname, '..', '_fixtures', 'source-maps');

let resolver: SourceMapResolver;

beforeEach(() => {
  // Fresh resolver (and cache) per test so source-map parses don't bleed between cases.
  resolver = new SourceMapResolver();
});

// NOTE: choosing WHICH metadata entry's frames to use (LOGICAL_ID.trace vs
// aws:cdk:creationStack) is toolkit-lib's findCreationStackTrace; this resolver
// only turns the chosen frames into a user source location.
describe('SourceMapResolver.resolveFrames', () => {
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
  const SAMPLE_JS = path.join(SOURCE_MAPS_DIR, 'sample.js');
  const SAMPLE_MAP = path.join(SOURCE_MAPS_DIR, 'sample.js.map');

  const tmpDirs: string[] = [];
  afterEach(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  // sample.js body without its trailing sourceMappingURL comment, so each test
  // can attach its own (inline or external) form. greet() stays on line 5.
  const sampleBody = (): string =>
    fs.readFileSync(SAMPLE_JS, 'utf-8').replace(/\/\/# sourceMappingURL=.*$/m, '').trimEnd();
  const tmpDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srcmap-'));
    tmpDirs.push(dir);
    return dir;
  };

  test('resolves .js to .ts using sibling .js.map', () => {
    // sample.js line 5: `function greet(name) {`
    const result = resolver.resolveFrames([`    at greet (${SAMPLE_JS}:5:10)`]);
    expect(result).toBeDefined();
    expect(result!.file).toContain('sample.ts');
    expect(result!.line).toBe(2); // ts line 2 = `export function greet`
  });

  test('falls back to .js location when no .js.map exists', () => {
    expect(resolver.resolveFrames(['    at someFn (/tmp/no-map-here.js:1:1)'])).toEqual({
      file: '/tmp/no-map-here.js', line: 1, column: 1,
    });
  });

  test('returns .ts location unchanged (no source-map needed)', () => {
    expect(resolver.resolveFrames(['    at someFn (/project/lib/foo.ts:3:2)'])).toEqual({
      file: '/project/lib/foo.ts', line: 3, column: 2,
    });
  });

  test('resolves an inline (data: URI) source map', () => {
    const b64 = Buffer.from(fs.readFileSync(SAMPLE_MAP, 'utf-8'), 'utf-8').toString('base64');
    const dir = tmpDir();
    const jsPath = path.join(dir, 'sample.js');
    fs.writeFileSync(jsPath, `${sampleBody()}\n//# sourceMappingURL=data:application/json;base64,${b64}\n`);

    const result = resolver.resolveFrames([`    at greet (${jsPath}:5:10)`]);
    expect(result!.file).toContain('sample.ts');
    expect(result!.line).toBe(2);
  });

  test('resolves an external map referenced under a non-default filename', () => {
    const dir = tmpDir();
    fs.copyFileSync(SAMPLE_MAP, path.join(dir, 'renamed.map'));
    const jsPath = path.join(dir, 'sample.js');
    fs.writeFileSync(jsPath, `${sampleBody()}\n//# sourceMappingURL=renamed.map\n`);

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

    const result = resolver.resolveFrames([`    at greet (${jsPath}:5:10)`]);
    expect(result!.file).toBe(path.join(dir, 'nested', 'sample.ts'));
    expect(result!.line).toBe(2);
  });
});
