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
