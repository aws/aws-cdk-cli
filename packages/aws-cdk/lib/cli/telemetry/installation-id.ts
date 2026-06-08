import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IoHelper } from '../../api-private';
import { cdkCacheDir, ensureCacheDir } from '../../util';


/**
 * Get or create installation id
 */
export async function getOrCreateInstallationId(ioHelper: IoHelper) {
  // Do this quite lazily, so we can mock `cdkCacheDir` during tests
  const installationIdPath = path.join(cdkCacheDir(), 'installation-id.json');
  console.log('path', installationIdPath);

  try {
    // Check if the installation ID file exists
    if (fs.existsSync(installationIdPath)) {
      const cachedId = fs.readFileSync(installationIdPath, 'utf-8').trim();

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
      await ensureCacheDir();
      fs.writeFileSync(installationIdPath, newId);
    } catch (e: any) {
      console.error(e);
      // If we can't write the file, still return the generated ID
      // but log a trace message about the failure
      await ioHelper.defaults.trace(`Failed to write installation ID to ${installationIdPath}: ${e}`);
    }
    return newId;
  } catch (e: any) {
    // If anything goes wrong, generate a temporary ID for this session
    // and log a trace message about the failure
    await ioHelper.defaults.trace(`Error getting installation ID: ${e}`);
    return randomUUID();
  }
}
