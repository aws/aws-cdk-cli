/**
 * Identifies a specific profile+region combination (an "environment" for test execution)
 */
export interface TestEnvironment {
  readonly profile?: string;
  readonly region: string;
  readonly account?: string;
}

export interface EnvironmentSummary {
  /**
   * Enviornments that got removed from the pool during the test run.s
   */
  readonly removed: RemovedEnvironment[];
}

/**
 * Information about why an environment was removed
 */
export interface RemovedEnvironment extends TestEnvironment {
  readonly reason: string;
  readonly removedAt: Date;
}

/**
 * Manages a pool of test environments for integration test workers.
 *
 * This class serves as a centralized pool for test environments, handling:
 * - Tracking which environments are available vs removed
 * - Recording removal reasons for reporting
 *
 * Future extensions could include:
 * - Load balancing across environments
 * - Rate limiting per environment
 * - Environment health scoring
 * - Automatic environment recovery
 */
export class EnvironmentPool {
  private readonly availableEnvironments: Set<string>;
  private readonly removedEnvironments: Map<string, RemovedEnvironment> = new Map();

  constructor(environments: TestEnvironment[]) {
    this.availableEnvironments = new Set(environments.map(e => this.makeKey(e)));
  }

  /**
   * Creates a unique key for a profile+region combination
   */
  private makeKey(env: TestEnvironment): string {
    return `${env.profile ?? 'default'}:${env.region}`;
  }

  /**
   * Parses a key back into a TestEnvironment
   */
  private parseKey(key: string): TestEnvironment {
    const [profile, region] = key.split(':');
    return {
      profile: profile === 'default' ? undefined : profile,
      region,
    };
  }

  /**
   * Marks an environment as removed (unavailable for future tests)
   */
  public removeEnvironment(env: TestEnvironment, reason: string): void {
    const key = this.makeKey(env);
    if (this.availableEnvironments.has(key)) {
      this.availableEnvironments.delete(key);
      this.removedEnvironments.set(key, {
        ...env,
        reason,
        removedAt: new Date(),
      });
    }
  }

  /**
   * Checks if an environment is still available
   */
  public isAvailable(env: TestEnvironment): boolean {
    return this.availableEnvironments.has(this.makeKey(env));
  }

  /**
   * Gets all available environments
   */
  public getAvailableEnvironments(): TestEnvironment[] {
    return Array.from(this.availableEnvironments).map(key => this.parseKey(key));
  }

  /**
   * Gets all removed environments with their removal info
   */
  public summary(): EnvironmentSummary {
    return {
      removed: Array.from(this.removedEnvironments.values()),
    };
  }
}
