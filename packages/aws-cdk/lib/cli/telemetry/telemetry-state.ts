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
  if (JSON.stringify(ret) !== oldState) {
    await writeTelemetryState(state);
  }

  return ret;
}

/**
 * Load telemetry state
 */
export async function loadTelemetryState(): Promise<TelemetryState> {
  try {
    return JSON.parse(await fs.readFile(TELEMETRY_STATE_PATH, 'utf-8'));
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return {};
    }
    throw e;
  }
}

export async function writeTelemetryState(state: TelemetryState) {
  await ensureCacheDir();

  await fs.writeFile(TELEMETRY_STATE_PATH, JSON.stringify(state, undefined, 2), 'utf-8');
}

const TELEMETRY_STATE_PATH = path.join(cdkCacheDir(), 'telemetry-state.json');
