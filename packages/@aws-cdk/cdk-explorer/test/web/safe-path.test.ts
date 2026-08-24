import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isSensitivePath, isSensitiveRead, isTemplatePath, resolveWithinRoot } from '../../lib/web/safe-path';

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

describe('isSensitivePath', () => {
  test.each([
    '.env',
    '.env.local',
    '.git/config',
    '.ssh/id_rsa',
    '.aws/credentials',
    '.npmrc',
    'config/.env',
    'lib/.git/HEAD',
    'certs/server.pem',
    'certs/SERVER.PEM',
    'keys/app.key',
    'keystore.jks',
    'aws/credentials',
    'home/id_ed25519',
  ])('denies %s', (relPath) => {
    expect(isSensitivePath(relPath)).toBe(true);
  });

  test.each([
    'app.ts',
    'lib/stack.ts',
    'bin/cdk.ts',
    'cdk.json',
    'cdk.context.json',
    'requirements.txt',
    'src/main/java/Stack.java',
    'node_modules/aws-cdk-lib/lib/index.ts',
    'MyStack.template.json',
    // A file merely containing "env" or "key" in its name is ordinary source.
    'lib/environment.ts',
    'lib/keys.ts',
  ])('allows %s', (relPath) => {
    expect(isSensitivePath(relPath)).toBe(false);
  });

  test('denies a windows-separated dotted segment', () => {
    expect(isSensitivePath('config\\.env')).toBe(true);
  });

  test('denies a relative path that escaped the root, since `..` is a dot segment', () => {
    expect(isSensitivePath('../outside/app.ts')).toBe(true);
  });
});

describe('isSensitiveRead', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-policy-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('allows an ordinary source file', () => {
    expect(isSensitiveRead(dir, path.join(dir, 'lib', 'stack.ts'))).toBe(false);
  });

  test('denies a dotfile under the root', () => {
    expect(isSensitiveRead(dir, path.join(dir, '.env'))).toBe(true);
  });

  test('tolerates a symlinked root rather than denying every read under it', () => {
    // macOS `/var` is a symlink to `/private/var`, so resolveWithinRoot hands back
    // a path under the real root while the configured root is the symlinked one.
    const real = fs.realpathSync(dir);
    const link = path.join(dir, 'self-link');
    try {
      fs.symlinkSync(real, link);
    } catch {
      return; // symlinks not permitted in this environment; skip
    }
    expect(isSensitiveRead(link, path.join(real, 'app.ts'))).toBe(false);
  });

  test('denies a symlink whose innocuous name points at a denied file', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'AWS_SECRET_ACCESS_KEY=hunter2\n');
    const link = path.join(dir, 'config.ts');
    try {
      fs.symlinkSync(path.join(dir, '.env'), link);
    } catch {
      return; // symlinks not permitted in this environment; skip
    }
    expect(isSensitiveRead(dir, link)).toBe(true);
  });
});

describe('isTemplatePath', () => {
  test.each([
    'MyStack.template.json',
    'nested/Inner.nested.template.json',
    'template.YAML',
    'template.yml',
  ])('accepts %s', (relPath) => {
    expect(isTemplatePath(relPath)).toBe(true);
  });

  test.each([
    'asset.abc123/index.js',
    'asset.abc123/.env',
    'asset.abc123/bundle.zip',
    'cdk.out/tree',
    'no-extension',
  ])('rejects %s', (relPath) => {
    expect(isTemplatePath(relPath)).toBe(false);
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
