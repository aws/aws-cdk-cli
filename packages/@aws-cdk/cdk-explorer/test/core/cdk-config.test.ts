import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCdkConfig } from '../../lib/core/cdk-config';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-cdkconfig-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeCdkJson(dir: string, contents: string): void {
  fs.writeFileSync(path.join(dir, 'cdk.json'), contents);
}

/**
 * `readCdkConfig` reports only what `cdk.json` actually says: `undefined` for
 * "there is no usable config here", and `undefined` fields for keys it does not
 * set. Defaulting is the caller's job (both servers resolve `output` against the
 * project dir with their own `?? 'cdk.out'`), so this never invents a value.
 */
describe('readCdkConfig', () => {
  test('returns the app command when present', async () => {
    await withTempDir(async (dir) => {
      writeCdkJson(dir, JSON.stringify({ app: 'npx tsx bin/app.ts' }));
      expect(await readCdkConfig(dir)).toEqual({ app: 'npx tsx bin/app.ts', output: undefined });
    });
  });

  test('returns the configured output directory', async () => {
    await withTempDir(async (dir) => {
      writeCdkJson(dir, JSON.stringify({ app: 'node bin/app.js', output: 'dist/assembly' }));
      expect(await readCdkConfig(dir)).toEqual({ app: 'node bin/app.js', output: 'dist/assembly' });
    });
  });

  test('reads output independently of a missing app command', async () => {
    await withTempDir(async (dir) => {
      writeCdkJson(dir, JSON.stringify({ output: 'dist/assembly' }));
      expect(await readCdkConfig(dir)).toEqual({ app: undefined, output: 'dist/assembly' });
    });
  });

  test('returns output verbatim, leaving a relative path for the caller to resolve', async () => {
    await withTempDir(async (dir) => {
      writeCdkJson(dir, JSON.stringify({ output: '../shared/cdk.out' }));
      expect((await readCdkConfig(dir))?.output).toBe('../shared/cdk.out');
    });
  });

  test('keeps an absolute configured output as-is', async () => {
    await withTempDir(async (dir) => {
      const absolute = path.join(path.sep, 'tmp', 'explorer-assembly');
      writeCdkJson(dir, JSON.stringify({ output: absolute }));
      expect((await readCdkConfig(dir))?.output).toBe(absolute);
    });
  });

  test.each([
    ['cdk.json is absent', undefined],
    ['cdk.json is malformed', '{not valid json'],
    ['cdk.json holds a JSON null', 'null'],
    ['cdk.json holds a non-object', '42'],
  ])('returns undefined when %s', async (_what, contents) => {
    await withTempDir(async (dir) => {
      if (contents !== undefined) {
        writeCdkJson(dir, contents);
      }
      expect(await readCdkConfig(dir)).toBeUndefined();
    });
  });

  test.each([
    ['app', { app: 42, output: 'out' }, 'app'],
    ['output', { app: 'node bin/app.js', output: 42 }, 'output'],
  ])('ignores a non-string %s value rather than passing it on', async (_what, config, key) => {
    await withTempDir(async (dir) => {
      writeCdkJson(dir, JSON.stringify(config));
      expect((await readCdkConfig(dir)) as Record<string, unknown>).toMatchObject({ [key]: undefined });
    });
  });

  test('keeps the other key when one is absent', async () => {
    await withTempDir(async (dir) => {
      writeCdkJson(dir, JSON.stringify({ context: { foo: 'bar' } }));
      expect(await readCdkConfig(dir)).toEqual({ app: undefined, output: undefined });
    });
  });
});
