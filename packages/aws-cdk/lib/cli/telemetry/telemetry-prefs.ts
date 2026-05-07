import * as path from 'path';
import * as fs from 'fs-extra';
import { cdkHomeDir } from '../../util';
import { tryReadJson } from '../util/fs-util';

const TELEMETRY_PREFS_PATH = path.join(cdkHomeDir(), 'telemetry-prefs.json');

export interface TelemetryPrefsFile {
  /**
   * If the user has given an Always/Never response to sending performance counters
   */
  defaultSendPerfCounters?: boolean;

  /**
   * If present, will be sent in every event
   */
  permanentCounters?: Record<string, number>;
}

export async function readTelemetryPrefs(): Promise<TelemetryPrefsFile> {
  return await tryReadJson(TELEMETRY_PREFS_PATH) ?? {};
}

export async function writeTelemetryPrefs(prefs: TelemetryPrefsFile) {
  await fs.writeJson(TELEMETRY_PREFS_PATH, prefs);
}

export async function updateTelemetryPrefs(updates: Partial<TelemetryPrefsFile>) {
  await writeTelemetryPrefs({
    ...await readTelemetryPrefs(),
    ...updates,
  });
}
