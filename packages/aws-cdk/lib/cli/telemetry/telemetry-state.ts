import * as fs from 'fs/promises';
import * as path from 'path';
import { ensureCacheDir } from './installation-id';
import { cdkCacheDir } from '../../util';

/**
 * Telemetry state across CLI invocations
 */
export interface TelemetryState {
  /**
   * How many deployment failures we've seen since the last success.
   */
  sequentialDeploymentFailures?: number;
}

/**
 * Run a function that can modify the given telemetry state.
 */
export async function withTelemetryState<A>(block: (x: TelemetryState) => A): Promise<A> {
  const state = await loadTelemetryState();
  const oldState = JSON.stringify(state);

  const ret = block(state);

  // Only write a file if the contents changed.
  if (JSON.stringify(state) !== oldState) {
    await writeTelemetryState(state);
  }

  return ret;
}

/**
 * Load telemetry state
 *
 * A file that isn't valid JSON (for example, cut short by a process that was killed while writing it)
 * counts as empty, so the next write replaces it.
 */
export async function loadTelemetryState(): Promise<TelemetryState> {
  let contents: string;
  try {
    contents = await fs.readFile(TELEMETRY_STATE_PATH, 'utf-8');
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return {};
    }
    throw e;
  }

  try {
    const state = JSON.parse(contents);
    return typeof state === 'object' && state !== null && !Array.isArray(state) ? state : {};
  } catch {
    return {};
  }
}

/**
 * Write telemetry state
 *
 * Writes to a temporary file and renames it into place, so a reader never sees a partly written file.
 */
export async function writeTelemetryState(state: TelemetryState) {
  await ensureCacheDir();

  const tempPath = `${TELEMETRY_STATE_PATH}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(state, undefined, 2), 'utf-8');
    await fs.rename(tempPath, TELEMETRY_STATE_PATH);
  } catch (e) {
    await fs.rm(tempPath, { force: true });
    throw e;
  }
}

const TELEMETRY_STATE_PATH = path.join(cdkCacheDir(), 'telemetry-state.json');
