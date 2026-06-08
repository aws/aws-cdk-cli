import * as path from 'path';
import { createSourceMapCache, resolveFramesToLocation, type SourceMapCache } from '../../lib/core/source-resolver';

const SOURCE_MAPS_DIR = path.join(__dirname, '..', '_fixtures', 'source-maps');

let cache: SourceMapCache;

beforeEach(() => {
  // Fresh cache per test so source-map parses don't bleed between cases.
  cache = createSourceMapCache();
});

// NOTE: choosing WHICH metadata entry's frames to use (LOGICAL_ID.trace vs
// aws:cdk:creationStack) is toolkit-lib's findCreationStackTrace; this module
// only turns the chosen frames into a user source location.
describe('resolveFramesToLocation', () => {
  test('returns undefined for no frames', () => {
    expect(resolveFramesToLocation(undefined, cache)).toBeUndefined();
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
    expect(resolveFramesToLocation(frames, cache)).toBeUndefined();
  });

  test('skips skip-placeholder frames and picks the first parseable user frame', () => {
    const frames = [
      '    ...node_modules-aws-cdk-lib...',
      '    at new MyStack (/project/lib/my-stack.ts:42:7)',
      '    at Object.<anonymous> (/project/bin/app.ts:8:1)',
    ];
    expect(resolveFramesToLocation(frames, cache)).toEqual({
      file: '/project/lib/my-stack.ts',
      line: 42,
      column: 7,
    });
  });
});

describe('source-map resolution', () => {
  const SAMPLE_JS = path.join(SOURCE_MAPS_DIR, 'sample.js');

  test('resolves .js to .ts using sibling .js.map', () => {
    // sample.js line 5: `function greet(name) {`
    const result = resolveFramesToLocation([`    at greet (${SAMPLE_JS}:5:10)`], cache);
    expect(result).toBeDefined();
    expect(result!.file).toContain('sample.ts');
    expect(result!.line).toBe(2); // ts line 2 = `export function greet`
  });

  test('falls back to .js location when no .js.map exists', () => {
    expect(resolveFramesToLocation(['    at someFn (/tmp/no-map-here.js:1:1)'], cache)).toEqual({
      file: '/tmp/no-map-here.js', line: 1, column: 1,
    });
  });

  test('returns .ts location unchanged (no source-map needed)', () => {
    expect(resolveFramesToLocation(['    at someFn (/project/lib/foo.ts:3:2)'], cache)).toEqual({
      file: '/project/lib/foo.ts', line: 3, column: 2,
    });
  });
});
