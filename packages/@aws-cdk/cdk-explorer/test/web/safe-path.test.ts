import * as path from 'path';
import { resolveWithinRoot } from '../../lib/web/safe-path';

const root = path.resolve('/srv/app');

describe('resolveWithinRoot', () => {
  test('resolves a simple relative path inside the root', () => {
    expect(resolveWithinRoot(root, 'lib/stack.ts')).toBe(path.join(root, 'lib/stack.ts'));
  });

  test('treats an empty path as the root itself', () => {
    expect(resolveWithinRoot(root, '')).toBe(root);
  });

  test('strips a leading slash instead of jumping to filesystem root', () => {
    expect(resolveWithinRoot(root, '/lib/stack.ts')).toBe(path.join(root, 'lib/stack.ts'));
  });

  test('rejects traversal above the root', () => {
    expect(resolveWithinRoot(root, '../secrets')).toBeUndefined();
    expect(resolveWithinRoot(root, '../../etc/passwd')).toBeUndefined();
    expect(resolveWithinRoot(root, 'lib/../../escape')).toBeUndefined();
  });

  test('allows traversal that stays within the root', () => {
    expect(resolveWithinRoot(root, 'lib/../bin/cdk.ts')).toBe(path.join(root, 'bin/cdk.ts'));
  });

  test('does not treat a sibling directory with a shared prefix as inside', () => {
    expect(resolveWithinRoot(root, '../app-secrets/file')).toBeUndefined();
  });
});

// Reload safe-path with `path` swapped for its
// win32 flavor to test real Windows behavior on the Linux runner.
describe('resolveWithinRoot (win32 semantics)', () => {
  const winRoot = 'C:\\srv\\app';
  let resolveWin: typeof resolveWithinRoot;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('path', () => jest.requireActual('path').win32);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolveWin = require('../../lib/web/safe-path').resolveWithinRoot;
  });

  afterAll(() => {
    jest.dontMock('path');
    jest.resetModules();
  });

  test('resolves forward-slash client paths under the root', () => {
    expect(resolveWin(winRoot, 'lib/stack.ts')).toBe('C:\\srv\\app\\lib\\stack.ts');
  });

  test('strips a leading backslash instead of jumping to the drive root', () => {
    expect(resolveWin(winRoot, '\\lib\\stack.ts')).toBe('C:\\srv\\app\\lib\\stack.ts');
  });

  test('rejects backslash traversal above the root', () => {
    expect(resolveWin(winRoot, '..\\secrets')).toBeUndefined();
  });

  test('rejects an absolute path on a different drive', () => {
    expect(resolveWin(winRoot, 'D:\\evil')).toBeUndefined();
  });

  test('does not treat a sibling drive-prefixed directory as inside', () => {
    expect(resolveWin(winRoot, '..\\app-secrets\\file')).toBeUndefined();
  });
});
