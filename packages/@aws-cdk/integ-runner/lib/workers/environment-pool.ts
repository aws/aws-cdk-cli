/**
 * Identifies a specific profile+region combination in which tests are executed
 */
export interface TestEnvironment {
  /**
   * The AWS profile used for the environment
   *
   * @default - default credentials
   */
  readonly profile?: string;

  /**
   * The AWS region of the environment
   */
  readonly region: string;

  /**
   * The AWS account of the environment, if known
   *
   * The account is usually only discovered once a test has run in the
   * environment, e.g. from a bootstrap error.
   *
   * @default - account is not known
   */
  readonly account?: string;
}

/**
 * An environment that was removed from the pool, and why
 */
export interface RemovedEnvironment extends TestEnvironment {
  /**
   * Human-readable reason for the removal
   */
  readonly reason: string;
}

/**
 * Summary of the state of the environment pool
 */
export interface EnvironmentSummary {
  /**
   * Environments that were removed from the pool during the test run
   */
  readonly removed: RemovedEnvironment[];
}

/**
 * Tracks which test environments (profile+region combinations) are still
 * usable during an integration test run.
 *
 * When a test discovers that an environment is unusable (e.g. it is not
 * bootstrapped), the environment is removed from the pool so no further
 * tests are scheduled there, and the removal is recorded for reporting.
 */
export class EnvironmentPool {
  private readonly available = new Map<string, TestEnvironment>();
  private readonly removed = new Map<string, RemovedEnvironment>();

  constructor(environments: TestEnvironment[]) {
    for (const env of environments) {
      this.available.set(key(env), env);
    }
  }

  /**
   * Whether the given environment is still available for running tests
   */
  public isAvailable(env: TestEnvironment): boolean {
    return this.available.has(key(env));
  }

  /**
   * Whether any environment is still available for running tests
   */
  public hasAvailable(): boolean {
    return this.available.size > 0;
  }

  /**
   * Remove an environment from the pool
   *
   * Only known, still-available environments are removed; removing the same
   * environment twice keeps the first removal record.
   *
   * @returns `true` if the environment was available and has now been removed
   */
  public remove(env: TestEnvironment, reason: string): boolean {
    const k = key(env);
    if (this.available.delete(k)) {
      this.removed.set(k, { ...env, reason });
      return true;
    }
    return false;
  }

  /**
   * Summary of removed environments, for end-of-run reporting
   */
  public summary(): EnvironmentSummary {
    return {
      removed: Array.from(this.removed.values()),
    };
  }
}

/**
 * Unique key for a profile+region combination
 *
 * Regions never contain `/`, so `profile/region` is unambiguous
 * (an undefined profile maps to an empty prefix).
 * The account is deliberately not part of the key: it is not known upfront
 * and the profile+region pair already identifies the credentials used.
 */
function key(env: TestEnvironment): string {
  return `${env.profile ?? ''}/${env.region}`;
}
