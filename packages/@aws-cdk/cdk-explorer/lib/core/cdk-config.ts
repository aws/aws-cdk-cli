import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * The subset of `cdk.json` the explorer cares about.
 *
 * `app` is the command CDK runs to produce a cloud assembly (e.g.
 * `npx tsx bin/app.ts`). We need it to invoke `Toolkit.synth()`
 * via `fromCdkApp`.
 */
export interface CdkConfig {
  readonly app?: string;
  readonly output?: string;
}

/**
 * Reads `<projectDir>/cdk.json` and returns the parts the explorer uses.
 * Never throws. Treats missing files, malformed JSON, or wrong-typed
 * fields as "not configured" so callers can fall back gracefully
 */
export async function readCdkConfig(projectDir: string): Promise<CdkConfig | undefined> {
  const configPath = path.join(projectDir, 'cdk.json');

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  } catch {
    return undefined;
  }

  if (parsed === null || typeof parsed !== 'object') return undefined;
  const app = (parsed as { app?: unknown }).app;
  const output = (parsed as { output?: unknown }).output;
  return {
    app: typeof app === 'string' ? app : undefined,
    output: typeof output === 'string' ? output : undefined,
  };
}
