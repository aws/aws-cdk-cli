import * as https from 'node:https';
import * as path from 'path';
import * as fs from 'fs-extra';
import { cdkCacheDir } from './';
import { IoHelper } from '../api/io/private';

interface CachedConnectivity {
  expiration: number;
  hasConnectivity: boolean;
}

const TIME_TO_LIVE_SUCCESS = 60 * 60 * 1000; // 1 hour
const CACHE_FILE_PATH = path.join(cdkCacheDir(), 'connection.json');

/**
 * Detects internet connectivity by making a lightweight request to the notices endpoint
 */
export class NetworkDetector {
  /**
   * Check if internet connectivity is available
   */
  public static async hasConnectivity(agent?: https.Agent, ioHelper?: IoHelper): Promise<boolean> {
    const cachedData = await this.load();
    const expiration = cachedData.expiration ?? 0;
    ioHelper?.notify({
      message: `hasconnectivity, ${JSON.stringify(cachedData)}`,
      time: new Date(Date.now()),
      level: 'info',
      data: undefined,
    });

    if (Date.now() > expiration) {
      try {
        const connected = await this.ping(agent);
        const updatedData = {
          expiration: Date.now() + TIME_TO_LIVE_SUCCESS,
          hasConnectivity: connected,
        };
        await this.save(updatedData);
        return connected;
      } catch {
        return false;
      }
    } else {
      return cachedData.hasConnectivity;
    }
  }

  private static readonly TIMEOUT_MS = 500;

  private static async load(): Promise<CachedConnectivity> {
    const defaultValue = {
      expiration: 0,
      hasConnectivity: false,
    };

    try {
      return fs.existsSync(CACHE_FILE_PATH)
        ? await fs.readJSON(CACHE_FILE_PATH) as CachedConnectivity
        : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private static async save(cached: CachedConnectivity): Promise<void> {
    try {
      await fs.ensureFile(CACHE_FILE_PATH);
      await fs.writeJSON(CACHE_FILE_PATH, cached);
    } catch {
      // Silently ignore cache save errors
    }
  }

  private static ping(agent?: https.Agent): Promise<boolean> {
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'cli.cdk.dev-tools.aws.dev',
        path: '/notices.json',
        method: 'HEAD',
        agent,
        timeout: this.TIMEOUT_MS,
      }, (res) => {
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }
}
