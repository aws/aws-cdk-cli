import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CLI_BIN_PATH_ENV, cliBinPath } from '../../../lib/cli/telemetry/cli-bin-path';

describe('cliBinPath', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-bin-path-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('prefers the path bin/cdk published about itself', () => {
    const binPath = path.join(tempDir, 'cdk');
    fs.writeFileSync(binPath, '#!/usr/bin/env node\n');

    expect(cliBinPath({ [CLI_BIN_PATH_ENV]: binPath })).toBe(binPath);
  });

  test('ignores the environment variable when it points at nothing', () => {
    const result = cliBinPath({ [CLI_BIN_PATH_ENV]: path.join(tempDir, 'does-not-exist') });

    // Falls back to walking up to this package's own bin/cdk, which does exist in the repo.
    expect(result).toBeDefined();
    expect(result!.endsWith(path.join('bin', 'cdk'))).toBe(true);
  });

  test('falls back to the package-relative bin/cdk when the variable is absent', () => {
    const result = cliBinPath({});

    expect(result).toBeDefined();
    expect(fs.existsSync(result!)).toBe(true);
    expect(result!.endsWith(path.join('bin', 'cdk'))).toBe(true);
  });

  test('the resolved fallback is this package\'s real entrypoint', () => {
    const result = cliBinPath({})!;

    // Sanity check that we resolved the actual CLI entrypoint and not some other file named `cdk`:
    // it must contain the sender dispatch guard.
    expect(fs.readFileSync(result, 'utf-8')).toContain('CDK_TELEMETRY_SENDER');
  });

  test('does not use process.argv[1]', () => {
    // argv[1] under jest is the jest worker, which must never be respawned as a telemetry sender.
    const result = cliBinPath({});

    expect(result).not.toBe(process.argv[1]);
  });
});
