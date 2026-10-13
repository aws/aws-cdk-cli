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

describe('readCdkConfig', () => {
  test('returns the app command when present', async () => {
    await withTempDir(async (dir) => {
      writeCdkJson(dir, JSON.stringify({ app: 'npx tsx bin/app.ts' }));
      expect(await readCdkConfig(dir)).toEqual({ app: 'npx tsx bin/app.ts', output: 'cdk.out' });
    });
  });

  test('returns undefined when cdk.json is absent', async () => {
    await withTempDir(async (dir) => {
      expect(await readCdkConfig(dir)).toEqual({ app: undefined, output: 'cdk.out' });
    });
  });

  test('returns undefined when cdk.json is malformed', async () => {
    await withTempDir(async (dir) => {
      writeCdkJson(dir, '{not valid json');
      expect(await readCdkConfig(dir)).toEqual({ app: undefined, output: 'cdk.out' });
    });
  });

  test('returns undefined when the app key is missing', async () => {
    await withTempDir(async (dir) => {
      writeCdkJson(dir, JSON.stringify({ context: {} }));
      expect(await readCdkConfig(dir)).toEqual({ app: undefined, output: 'cdk.out' });
    });
  });

  test('returns undefined when the app value is not a string', async () => {
    await withTempDir(async (dir) => {
      writeCdkJson(dir, JSON.stringify({ app: 42 }));
      expect(await readCdkConfig(dir)).toEqual({ app: undefined, output: 'cdk.out' });
    });
  });

  test('returns undefined when cdk.json contains a JSON null', async () => {
    await withTempDir(async (dir) => {
      writeCdkJson(dir, 'null');
      expect(await readCdkConfig(dir)).toEqual({ app: undefined, output: 'cdk.out' });
    });
  });

  describe('output', () => {
    test('returns the configured output directory', async () => {
      await withTempDir(async (dir) => {
        writeCdkJson(dir, JSON.stringify({ app: 'node bin/app.js', output: 'dist/assembly' }));
        expect((await readCdkConfig(dir)).output).toBe('dist/assembly');
      });
    });

    test('is returned verbatim, so relative paths stay relative for the caller to resolve', async () => {
      await withTempDir(async (dir) => {
        writeCdkJson(dir, JSON.stringify({ output: '../shared/cdk.out' }));
        expect((await readCdkConfig(dir)).output).toBe('../shared/cdk.out');
      });
    });

    test('keeps an absolute configured path as-is', async () => {
      await withTempDir(async (dir) => {
        const absolute = path.join(path.sep, 'tmp', 'explorer-assembly');
        writeCdkJson(dir, JSON.stringify({ output: absolute }));
        expect((await readCdkConfig(dir)).output).toBe(absolute);
      });
    });

    test('falls back to cdk.out when the output key is missing', async () => {
      await withTempDir(async (dir) => {
        writeCdkJson(dir, JSON.stringify({ app: 'node bin/app.js' }));
        expect((await readCdkConfig(dir)).output).toBe('cdk.out');
      });
    });

    test('falls back to cdk.out when the output value is not a string', async () => {
      await withTempDir(async (dir) => {
        writeCdkJson(dir, JSON.stringify({ app: 'node bin/app.js', output: 42 }));
        expect((await readCdkConfig(dir)).output).toBe('cdk.out');
      });
    });

    test('falls back to cdk.out when the output value is null', async () => {
      await withTempDir(async (dir) => {
        writeCdkJson(dir, JSON.stringify({ app: 'node bin/app.js', output: null }));
        expect((await readCdkConfig(dir)).output).toBe('cdk.out');
      });
    });

    test('reads output independently of a missing app command', async () => {
      await withTempDir(async (dir) => {
        writeCdkJson(dir, JSON.stringify({ output: 'dist/assembly' }));
        expect(await readCdkConfig(dir)).toEqual({ app: undefined, output: 'dist/assembly' });
      });
    });
  });
});
