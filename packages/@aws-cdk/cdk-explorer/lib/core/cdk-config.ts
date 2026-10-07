import * as fs from 'fs';
import * as path from 'path';

/**
 * The subset of `cdk.json` the explorer cares about.
 *
 * `app` is the command CDK runs to produce a cloud assembly (e.g.
 * `npx tsx bin/app.ts`). We need it to invoke `Toolkit.synth()`
 * via `fromCdkApp`.
 */
export interface CdkConfig {
  /** The `app` command, or `undefined` if missing/malformed. */
  readonly app: string | undefined;
  readonly output: string;
}

/**
 * Reads `<projectDir>/cdk.json` and returns the parts the explorer uses.
 * Never throws. Treats missing files, malformed JSON, or wrong-typed
 * fields as "not configured" so callers can fall back gracefully
 */
export function readCdkConfig(projectDir: string): CdkConfig {
  const configPath = path.join(projectDir, 'cdk.json');
  if (!fs.existsSync(configPath)) return { app: undefined, output: 'cdk.out' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return { app: undefined, output: 'cdk.out' };
  }

  if (parsed === null || typeof parsed !== 'object') return { app: undefined, output: 'cdk.out' };
  const app = (parsed as { app?: unknown }).app;
  const output = (parsed as { output?: unknown }).output;
  return {
    app: typeof app === 'string' ? app : undefined,
    output: typeof output === 'string' ? output : 'cdk.out',
  };
}
