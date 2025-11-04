import type { Agent } from 'https';
import { request } from 'https';

/**
 * Detects internet connectivity by making a lightweight request to the notices endpoint
 */
export class NetworkDetector {
  private static readonly CACHE_DURATION_MS = 30_000; // 30 seconds
  private static readonly TIMEOUT_MS = 500;
  
  private static cachedResult: boolean | undefined;
  private static cacheExpiry: number = 0;

  /**
   * Check if internet connectivity is available
   */
  public static async hasConnectivity(agent?: Agent): Promise<boolean> {
    const now = Date.now();
    
    // Return cached result if still valid
    if (this.cachedResult !== undefined && now < this.cacheExpiry) {
      return this.cachedResult;
    }

    try {
      const connected = await this.ping(agent);
      this.cachedResult = connected;
      this.cacheExpiry = now + this.CACHE_DURATION_MS;
      return connected;
    } catch {
      this.cachedResult = false;
      this.cacheExpiry = now + this.CACHE_DURATION_MS;
      return false;
    }
  }

  private static ping(agent?: Agent): Promise<boolean> {
    return new Promise((resolve) => {
      const req = request({
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
