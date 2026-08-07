import * as fs from 'node:fs';
import * as path from 'node:path';
import { cliRootDir } from '../root-dir';

/**
 * Environment variable through which `bin/cdk` records its own location.
 *
 * `bin/cdk` is the only place that knows this reliably, so it publishes `__filename` here.
 */
export const CLI_BIN_PATH_ENV = 'CDK_CLI_BIN_PATH';

/**
 * Locate this CLI's `bin/cdk` script, so that we can respawn ourselves as a telemetry sender.
 *
 * `process.argv[1]` is deliberately NOT used. Depending on how the CLI was started it points at
 * something else entirely:
 *
 * - installed normally, it is the `node_modules/.bin/cdk` symlink;
 * - installed via the `cdk` alias package, it resolves to that package's wrapper, not ours;
 * - used programmatically (`require('aws-cdk').cli()`), it is the caller's own script -- respawning
 *   it would re-run somebody else's program.
 *
 * So we prefer the path `bin/cdk` published about itself, and fall back to walking up from this
 * module to the package root (which works both from `lib/` in source and from the bundle).
 *
 * Returns undefined if no candidate exists on disk, in which case telemetry is skipped.
 */
export function cliBinPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [
    env[CLI_BIN_PATH_ENV],
    packageRelativeBinPath(),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function packageRelativeBinPath(): string | undefined {
  const root = cliRootDir(false);
  return root ? path.join(root, 'bin', 'cdk') : undefined;
}
