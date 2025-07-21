import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { IoHelper } from '../../api-private';
import { cdkCacheDir } from '../../util';

const INSTALLATION_ID_PATH = path.join(cdkCacheDir(), 'installation-id.json');

/**
 * Get or create installation id
 */
export async function getOrCreateInstallationId(ioHelper: IoHelper) {
  try {
    // Create the cache directory if it doesn't exist
    if (!fs.existsSync(path.dirname(INSTALLATION_ID_PATH))) {
      fs.mkdirSync(path.dirname(INSTALLATION_ID_PATH), { recursive: true });
    }

    // Check if the installation ID file exists
    if (fs.existsSync(INSTALLATION_ID_PATH)) {
      const cachedId = fs.readFileSync(INSTALLATION_ID_PATH, 'utf-8').trim();

      // Validate that the cached ID is a valid UUID
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (UUID_REGEX.test(cachedId)) {
        return cachedId;
      }
      // If invalid, fall through to create a new one
    }

    // Create a new installation ID
    const newId = randomUUID();
    try {
      fs.writeFileSync(INSTALLATION_ID_PATH, newId);
    } catch (e: any) {
      // If we can't write the file, still return the generated ID
      // but log a trace message about the failure
      await ioHelper.defaults.trace(`Failed to write installation ID to ${INSTALLATION_ID_PATH}: ${e}`);
    }
    return newId;
  } catch (e: any) {
    // If anything goes wrong, generate a temporary ID for this session
    // and log a trace message about the failure
    await ioHelper.defaults.trace(`Error getting installation ID: ${e}`);
    return randomUUID();
  }
}
