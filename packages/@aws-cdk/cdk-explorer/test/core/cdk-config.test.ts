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
      writeCdkJson(dir, JSON.stringify({ app: 'npx ts-node bin/app.ts' }));
      expect(readCdkConfig(dir)).toEqual({ app: 'npx ts-node bin/app.ts' });
    });
  });

  test('returns undefined when cdk.json is absent', () => {
    withTempDir((dir) => {
      expect(readCdkConfig(dir)).toEqual({ app: undefined });
    });
  });

  test('returns undefined when cdk.json is malformed', () => {
    withTempDir((dir) => {
      writeCdkJson(dir, '{not valid json');
      expect(readCdkConfig(dir)).toEqual({ app: undefined });
    });
  });

  test('returns undefined when the app key is missing', () => {
    withTempDir((dir) => {
      writeCdkJson(dir, JSON.stringify({ context: {} }));
      expect(readCdkConfig(dir)).toEqual({ app: undefined });
    });
  });

  test('returns undefined when the app value is not a string', () => {
    withTempDir((dir) => {
      writeCdkJson(dir, JSON.stringify({ app: 42 }));
      expect(readCdkConfig(dir)).toEqual({ app: undefined });
    });
  });

  test('returns undefined when cdk.json contains a JSON null', () => {
    withTempDir((dir) => {
      writeCdkJson(dir, 'null');
      expect(readCdkConfig(dir)).toEqual({ app: undefined });
    });
  });
});
