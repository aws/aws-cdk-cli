import { format } from 'node:util';
import type { ICloudFormationClient } from '../aws-auth/private';
import { IO, type IoHelper } from '../io/private';

/**
 * Minimum time between the start of two polls in the same account and region, before backoff
 *
 * Caps the combined poll rate of all stacks deployed at the same time, and staggers their polls
 * instead of sending them all at once.
 */
const POLL_SPACING_MS = 100;

/**
 * The longest a poller waits between two polls because of backoff
 */
const MAX_POLL_INTERVAL_MS = 60_000;

/**
 * Polling slower than this because of throttling is reported as a warning
 */
const WARN_POLL_INTERVAL_MS = 30_000;

/**
 * The largest factor by which polling is slowed down
 */
const MAX_BACKOFF = 32;

/**
 * Backoff grows at most once in this period
 *
 * Many pollers tend to be throttled at the same moment, which should count as one signal.
 */
const BACKOFF_COOLDOWN_MS = 2_000;

/**
 * Backoff halves for every period of this length without throttling
 */
const RECOVERY_MS = 20_000;

/**
 * Whether an error means the request was throttled
 */
export function isThrottlingError(e: any): boolean {
  return THROTTLING_ERROR_NAMES.has(e?.name)
    || e?.$retryable?.throttling === true
    || e?.$metadata?.httpStatusCode === 429;
}

const THROTTLING_ERROR_NAMES = new Set([
  'Throttling',
  'ThrottlingException',
  'ThrottledException',
  'RequestThrottledException',
  'TooManyRequestsException',
  'RequestLimitExceeded',
  'RequestThrottled',
]);

/**
 * Paces the polling of CloudFormation in one account and region
 *
 * CloudFormation throttles requests per account and region, so every poller in the same account
 * and region (across all stacks deployed at the same time) shares one schedule:
 *
 * - Polls are spaced out, so that many stacks deployed at the same time stagger their polls and
 *   their combined rate is capped.
 * - When a request is throttled, or only succeeded after the SDK retried it, all pollers slow down
 *   together. Polling speeds up again once requests stop being throttled.
 * - A `Retry-After` hint on a throttled request delays the next poll accordingly.
 */
export class PollSchedule {
  /**
   * Get the schedule for the account and region of the first ARN among the given names or ARNs
   *
   * Pollers that only know a name share a schedule for an unknown account and region.
   */
  public static for(...namesOrArns: string[]): PollSchedule {
    const key = namesOrArns.map(throttlingScope).find((scope) => scope !== undefined) ?? UNKNOWN_SCOPE;
    let schedule = PollSchedule.schedules.get(key);
    if (!schedule) {
      schedule = new PollSchedule(key);
      PollSchedule.schedules.set(key, schedule);
    }
    return schedule;
  }

  /**
   * Forget all schedules, so that tests do not influence each other
   */
  public static resetAll() {
    PollSchedule.schedules.clear();
  }

  private static readonly schedules = new Map<string, PollSchedule>();

  /**
   * Description of the account and region, for messages
   */
  public readonly scope: string;

  private peakBackoff = 1;
  private lastIncrease = -Infinity;
  private lastThrottle = -Infinity;
  private nextSlot = 0;
  private activePollers = 0;
  private warned = false;

  private constructor(private readonly key: string) {
    this.scope = describeScope(key);
  }

  /**
   * The factor by which polling is currently slowed down
   */
  public get backoff(): number {
    const halvings = Math.floor((Date.now() - this.lastThrottle) / RECOVERY_MS);
    return Math.max(1, this.peakBackoff / (2 ** halvings));
  }

  /**
   * Wrap a client so that the outcome of its requests informs this schedule
   */
  public observe(cfn: ICloudFormationClient): ICloudFormationClient {
    return new Proxy(cfn, {
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') {
          return value;
        }
        return async (...args: unknown[]) => {
          try {
            const response = await value.apply(target, args);
            if ((response?.$metadata?.attempts ?? 1) > 1) {
              this.recordThrottle();
            }
            return response;
          } catch (e: any) {
            if (isThrottlingError(e)) {
              this.recordThrottle(retryAfter(e));
            }
            throw e;
          }
        };
      },
    });
  }

  /**
   * Pace a polling loop that polls at the given interval when nothing is throttled
   */
  public pacer(options: PollPacerOptions): PollPacer {
    this.activePollers++;
    return new PollPacer(this, options);
  }

  /**
   * Wait for the next free slot to send a poll
   */
  public async slot(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + POLL_SPACING_MS * this.backoff;
    if (at > now) {
      await sleep(at - now);
    }
  }

  /**
   * Whether a slow poller should warn about it, which only one of them should per bout of throttling
   */
  public shouldWarn(interval: number): boolean {
    if (this.backoff === 1) {
      this.warned = false;
      return false;
    }
    if (this.warned || interval <= WARN_POLL_INTERVAL_MS) {
      return false;
    }
    this.warned = true;
    return true;
  }

  /**
   * Stop counting a poller as using this schedule
   */
  public release() {
    this.activePollers--;
    // Forget the schedule once nothing uses it and there is no backoff left to remember
    if (this.activePollers === 0 && this.backoff === 1 && PollSchedule.schedules.get(this.key) === this) {
      PollSchedule.schedules.delete(this.key);
    }
  }

  private recordThrottle(retryAt?: number) {
    const now = Date.now();
    if (now - this.lastIncrease >= BACKOFF_COOLDOWN_MS) {
      this.peakBackoff = Math.min(this.backoff * 2, MAX_BACKOFF);
      this.lastIncrease = now;
    } else {
      this.peakBackoff = this.backoff;
    }
    this.lastThrottle = now;

    if (retryAt !== undefined) {
      this.nextSlot = Math.max(this.nextSlot, Math.min(retryAt, now + MAX_POLL_INTERVAL_MS));
    }
  }
}

export interface PollPacerOptions {
  readonly ioHelper: IoHelper;

  /**
   * Time in milliseconds between two polls when nothing is throttled
   */
  readonly interval: number;

  /**
   * What is being polled, for messages
   *
   * @example 'stack MyStack'
   */
  readonly description: string;
}

/**
 * Paces one polling loop on a shared `PollSchedule`
 */
export class PollPacer {
  private readonly ioHelper: IoHelper;
  private readonly baseInterval: number;
  private readonly description: string;
  private currentInterval: number;
  private released = false;

  constructor(private readonly schedule: PollSchedule, options: PollPacerOptions) {
    this.ioHelper = options.ioHelper;
    this.baseInterval = options.interval;
    this.description = options.description;
    this.currentInterval = options.interval;
  }

  /**
   * The time to wait before the next poll
   */
  public async nextInterval(): Promise<number> {
    const interval = Math.min(this.baseInterval * this.schedule.backoff, Math.max(this.baseInterval, MAX_POLL_INTERVAL_MS));

    if (interval !== this.currentInterval) {
      const reason = interval > this.currentInterval ? `CloudFormation is throttling requests in ${this.schedule.scope}` : 'CloudFormation stopped throttling requests';
      await this.ioHelper.defaults.debug(format('%s, polling %s every %s', reason, this.description, seconds(interval)));
      this.currentInterval = interval;
    }

    if (this.schedule.shouldWarn(interval)) {
      await this.ioHelper.notify(IO.CDK_TOOLKIT_W5501.msg(format(
        'CloudFormation is throttling requests in %s, progress of %s is only checked every %s. Deploying fewer stacks at the same time reduces throttling.',
        this.schedule.scope, this.description, seconds(interval),
      )));
    }

    return interval;
  }

  /**
   * Wait for this loop's turn to send a poll
   */
  public async slot(): Promise<void> {
    return this.schedule.slot();
  }

  /**
   * Stop using the schedule
   */
  public release() {
    if (!this.released) {
      this.released = true;
      this.schedule.release();
    }
  }

  /**
   * Report a poll that failed because it was throttled
   */
  public async reportThrottled(e: unknown) {
    await this.ioHelper.defaults.debug(format('Throttled while polling %s, polling again later: %s', this.description, e));
  }
}

/**
 * Poll until the provider returns a value other than `undefined`
 *
 * Returns `undefined` if the provider returns `null`. A poll that fails because it was throttled is
 * tried again later, for as long as it takes; any other error ends the polling.
 */
export async function pollUntil<T>(
  pacer: PollPacer,
  valueProvider: () => Promise<T | null | undefined>,
): Promise<T | undefined> {
  try {
    while (true) {
      await pacer.slot();

      let result: T | null | undefined;
      try {
        result = await valueProvider();
      } catch (e) {
        if (!isThrottlingError(e)) {
          throw e;
        }
        await pacer.reportThrottled(e);
      }

      if (result === null) {
        return undefined;
      } else if (result !== undefined) {
        return result;
      }

      await sleep(await pacer.nextInterval());
    }
  } finally {
    pacer.release();
  }
}

const UNKNOWN_SCOPE = 'unknown';

/**
 * The scope CloudFormation throttles in, from an ARN
 */
function throttlingScope(nameOrArn: string): string | undefined {
  const [prefix, partition, , region, account] = nameOrArn.split(':');
  if (prefix !== 'arn' || !partition || !region || !account) {
    return undefined;
  }
  return `${partition}:${region}:${account}`;
}

function describeScope(key: string): string {
  if (key === UNKNOWN_SCOPE) {
    return 'this account and region';
  }
  const [, region, account] = key.split(':');
  return `account ${account} in ${region}`;
}

/**
 * The time a throttled request asks to be retried at, if it says
 */
function retryAfter(e: any): number | undefined {
  const headers: Record<string, string> = e?.$response?.headers ?? {};
  for (const [name, value] of Object.entries(headers)) {
    const header = name.toLowerCase();
    if (header === 'x-amz-retry-after' && isFinite(Number(value))) {
      return Date.now() + Number(value);
    }
    if (header === 'retry-after') {
      if (/^\d+(\.\d+)?$/.test(value)) {
        return Date.now() + Number(value) * 1000;
      }
      const date = Date.parse(value);
      return isNaN(date) ? undefined : date;
    }
  }
  return undefined;
}

function seconds(ms: number) {
  return `${Math.round(ms / 100) / 10}s`;
}

function sleep(ms: number) {
  return new Promise((ok) => setTimeout(ok, ms));
}
