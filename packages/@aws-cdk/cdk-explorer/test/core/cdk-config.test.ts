import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCdkConfig } from '../../lib/core/cdk-config';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-cdkconfig-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeCdkJson(dir: string, contents: string): void {
  fs.writeFileSync(path.join(dir, 'cdk.json'), contents);
}

describe('readCdkConfig', () => {
  test('returns the app command when present', () => {
    withTempDir((dir) => {
      writeCdkJson(dir, JSON.stringify({ app: 'npx tsx bin/app.ts' }));
      expect(readCdkConfig(dir)).toEqual({ app: 'npx tsx bin/app.ts', output: 'cdk.out' });
    });
  });

  test('returns undefined when cdk.json is absent', () => {
    withTempDir((dir) => {
      expect(readCdkConfig(dir)).toEqual({ app: undefined, output: 'cdk.out' });
    });
  });

  test('returns undefined when cdk.json is malformed', () => {
    withTempDir((dir) => {
      writeCdkJson(dir, '{not valid json');
      expect(readCdkConfig(dir)).toEqual({ app: undefined, output: 'cdk.out' });
    });
  });

  test('returns undefined when the app key is missing', () => {
    withTempDir((dir) => {
      writeCdkJson(dir, JSON.stringify({ context: {} }));
      expect(readCdkConfig(dir)).toEqual({ app: undefined, output: 'cdk.out' });
    });
  });

  test('returns undefined when the app value is not a string', () => {
    withTempDir((dir) => {
      writeCdkJson(dir, JSON.stringify({ app: 42 }));
      expect(readCdkConfig(dir)).toEqual({ app: undefined, output: 'cdk.out' });
    });
  });

  test('returns undefined when cdk.json contains a JSON null', () => {
    withTempDir((dir) => {
      writeCdkJson(dir, 'null');
      expect(readCdkConfig(dir)).toEqual({ app: undefined, output: 'cdk.out' });
    });
  });

  describe('output', () => {
    test('returns the configured output directory', () => {
      withTempDir((dir) => {
        writeCdkJson(dir, JSON.stringify({ app: 'node bin/app.js', output: 'dist/assembly' }));
        expect(readCdkConfig(dir).output).toBe('dist/assembly');
      });
    });

    test('is returned verbatim, so relative paths stay relative for the caller to resolve', () => {
      withTempDir((dir) => {
        writeCdkJson(dir, JSON.stringify({ output: '../shared/cdk.out' }));
        expect(readCdkConfig(dir).output).toBe('../shared/cdk.out');
      });
    });

    test('keeps an absolute configured path as-is', () => {
      withTempDir((dir) => {
        const absolute = path.join(path.sep, 'tmp', 'explorer-assembly');
        writeCdkJson(dir, JSON.stringify({ output: absolute }));
        expect(readCdkConfig(dir).output).toBe(absolute);
      });
    });

    test('falls back to cdk.out when the output key is missing', () => {
      withTempDir((dir) => {
        writeCdkJson(dir, JSON.stringify({ app: 'node bin/app.js' }));
        expect(readCdkConfig(dir).output).toBe('cdk.out');
      });
    });

    test('falls back to cdk.out when the output value is not a string', () => {
      withTempDir((dir) => {
        writeCdkJson(dir, JSON.stringify({ app: 'node bin/app.js', output: 42 }));
        expect(readCdkConfig(dir).output).toBe('cdk.out');
      });
    });

    test('falls back to cdk.out when the output value is null', () => {
      withTempDir((dir) => {
        writeCdkJson(dir, JSON.stringify({ app: 'node bin/app.js', output: null }));
        expect(readCdkConfig(dir).output).toBe('cdk.out');
      });
    });

    test('reads output independently of a missing app command', () => {
      withTempDir((dir) => {
        writeCdkJson(dir, JSON.stringify({ output: 'dist/assembly' }));
        expect(readCdkConfig(dir)).toEqual({ app: undefined, output: 'dist/assembly' });
      });
    });
  });
});
