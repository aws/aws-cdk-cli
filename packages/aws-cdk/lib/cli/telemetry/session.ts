import { randomUUID } from 'node:crypto';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { getOrCreateInstallationId } from './installation-id';
import { getLibraryVersion } from './library-version';
import { sanitizeCommandLineArguments, sanitizeContext } from './sanitation';
import { type EventType, type SessionSchema, type State, type ErrorDetails } from './schema';
import type { ITelemetrySink } from './sink/sink-interface';
import type { Context } from '../../api/context';
import type { IMessageSpan } from '../../api-private';
import { detectCiSystem } from '../ci-systems';
import type { CliIoHost } from '../io-host/cli-io-host';
import type { EventResult } from '../telemetry/messages';
import { CLI_PRIVATE_SPAN } from '../telemetry/messages';
import { isCI } from '../util/ci';
import { versionNumber } from '../version';
import { USER_INTERRUPTED_CODE } from './error';
import { withTelemetryState } from './telemetry-state';

const ABORTED_ERROR_MESSAGE = '__CDK-Toolkit__Aborted';

/**
 * Valid user agent prefixes that are allowed to report through CDK_CLI_USERAGENT.
 * This creates a mechanism to report user agents we control.
 */
const VALID_USER_AGENTS = ['aws-blocks'];

export interface TelemetrySessionProps {
  readonly ioHost: CliIoHost;
  readonly client: ITelemetrySink;
  readonly arguments: any;
  readonly context: Context;
}

export interface TelemetryEvent {
  readonly eventType: EventType;
  readonly duration: number;
  readonly error?: ErrorDetails;
  readonly counters?: Record<string, number>;
}

/**
 * Timer of a single event
 */
export interface Timing {
  /**
   * Total time spent in this operation
   */
  totalMs: number;

  /**
   * Count of operations that together took `totalMs`.
   */
  count: number;
}

export class TelemetrySession {
  private ioHost: CliIoHost;
  private client: ITelemetrySink;
  private _sessionInfo?: SessionSchema;
  private _commandSpan?: IMessageSpan<EventResult>;
  private _nextEventCounters?: Record<string, number>;
  private count = 0;
  private loadTime?: number;

  constructor(private readonly props: TelemetrySessionProps) {
    this.ioHost = props.ioHost;
    this.client = props.client;
  }

  /**
   * The span that represents the CLI invocation.
   *
   * In the code, this span is named COMMAND but the matching event type
   * in telemetry will be INVOKE.
   *
   * Will be emitted exactly once, at the end of the CLI operation.
   */
  public get commandSpan(): IMessageSpan<EventResult> | undefined {
    return this._commandSpan;
  }

  public async begin() {
    // sanitize the raw cli input
    const { path, parameters } = sanitizeCommandLineArguments(this.props.arguments);
    this._sessionInfo = {
      identifiers: {
        installationId: await getOrCreateInstallationId(this.ioHost.asIoHelper()),
        sessionId: randomUUID(),
        telemetryVersion: '2.0',
        cdkCliVersion: versionNumber(),
        cdkLibraryVersion: await getLibraryVersion(this.ioHost.asIoHelper()),
      },
      event: {
        command: {
          path,
          parameters,
          config: {
            context: sanitizeContext(this.props.context),
            ...(isValidWrapperUserAgent(process.env.CDK_CLI_USERAGENT)
              ? { cdkCliUserAgent: { [process.env.CDK_CLI_USERAGENT]: true } }
              : {}),
          },
        },
      },
      environment: {
        ci: isCI() || Boolean(detectCiSystem()),
        os: {
          platform: process.platform,
          release: process.release.name,
        },
        nodeVersion: process.version,
      },
      project: {},
    };

    // If SIGINT has a listener installed, its default behavior will be removed (Node.js will no longer exit).
    // This ensures that on SIGINT we process safely close the telemetry session before exiting.
    process.on('SIGINT', async () => {
      try {
        await this.end({
          name: USER_INTERRUPTED_CODE,
          message: ABORTED_ERROR_MESSAGE,
        });
      } catch (e: any) {
        await this.ioHost.defaults.trace(`Ending Telemetry failed: ${e.message}`);
      }
      process.exit(1);
    });

    // Begin the session span
    this._commandSpan = await this.ioHost.asIoHelper().span(CLI_PRIVATE_SPAN.COMMAND).begin({});
  }

  public async attachRegion(region: string) {
    this.sessionInfo.identifiers = {
      ...this.sessionInfo.identifiers,
      region,
    };
  }

  /**
   * Attach a language guess
   */
  public attachLanguage(language: string | undefined) {
    // Don't want to crash accidentally
    if (!this._sessionInfo) {
      return;
    }

    if (language) {
      mutable(this.sessionInfo.project).language = language;
    }
  }

  /**
   * Attach our best guess at running under an agent or not
   */
  public attachAgent(isAgent: boolean | undefined) {
    // Don't want to crash accidentally
    if (!this._sessionInfo) {
      return;
    }

    mutable(this.sessionInfo.environment).agent = isAgent;
  }

  /**
   * Temporarily attach counters for the next event operation.
   *
   * They may be committed to the sent telemetry later.
   */
  public attachCountersToNextEvent(counters: Record<string, number>) {
    this._nextEventCounters = counters;
  }

  /**
   * Set the load time (will be emitted with the COMMAND span)
   */
  public attachLoadTime(loadTime: number) {
    this.loadTime = loadTime;
    this._commandSpan?.addTimer('load', loadTime);
  }

  /**
   * Mark when the actual CLI operation starts
   *
   * Emitted as part of the COMMAND span.
   */
  public markOperationStart() {
    if (this.loadTime) {
      this._commandSpan?.addTimer('init', performance.now() - this.loadTime);
    }
  }

  /**
   * Attach the CDK library version
   *
   * By default the telemetry will guess at the CDK library version if it so
   * happens that the CDK project is an NPM project and the CDK CLI is executed
   * in the root of NPM project with `aws-cdk-lib` available in `node_modules`.
   * This may succeed or may fail.
   *
   * Once we have produced and loaded the cloud assembly more accurate
   * information becomes available that we can add in.
   */
  public attachCdkLibVersion(libVersion: string) {
    // Don't want to crash accidentally
    if (!this._sessionInfo) {
      return;
    }

    mutable(this.sessionInfo.identifiers).cdkLibraryVersion = libVersion;
  }

  /**
   * When the command is complete, so is the CliIoHost. Ends the span of the entire CliIoHost
   * and notifies with an optional error message in the data.
   */
  public async end(error?: ErrorDetails) {
    await this._commandSpan?.end({ error });
    // Ideally span.end() should no-op if called twice, but that is not the case right now
    this._commandSpan = undefined;
    await this.client.flush();
  }

  public async emit(event: TelemetryEvent): Promise<void> {
    this.count += 1;

    const counters = {
      ...this._nextEventCounters,
      ...event.counters,
    };
    this._nextEventCounters = undefined;

    if (event.eventType == 'DEPLOY') {
      await this.trackDeployStatistics(event.error === undefined, counters);
    }

    return this.client.emit({
      event: {
        command: this.sessionInfo.event.command,
        state: getState(event.error),
        eventType: event.eventType,
      },
      identifiers: {
        ...this.sessionInfo.identifiers,
        eventId: `${this.sessionInfo.identifiers.sessionId}:${this.count}`,
        timestamp: new Date().toISOString(),
      },
      environment: this.sessionInfo.environment,
      project: this.sessionInfo.project,
      duration: {
        total: event.duration,
      },
      ...(event.error ? {
        error: {
          name: event.error.name,
        },
      } : {}),
      ...(Object.keys(counters).length > 0 ? { counters } : {}),
    });
  }

  /**
   * This is a DEPLOY event, track some additional statistics about it
   *
   * We use this to measure things about deployment failures, such as the number of
   * failed DEPLOY events in a sequence.
   */
  private async trackDeployStatistics(isSuccessful: boolean, counters: Record<string, number>) {
    await withTelemetryState((state) => {
      const recentFailures = state.sequentialDeploymentFailures ?? 0;

      if (isSuccessful) {
        state.sequentialDeploymentFailures = 0;
      } else {
        state.sequentialDeploymentFailures = recentFailures + 1;
      }

      counters.sequentialDeploymentFailures = state.sequentialDeploymentFailures;
    });
  }

  private get sessionInfo(): SessionSchema {
    if (!this._sessionInfo) {
      throw new ToolkitError('SessionNotInitialized', 'Session Info not initialized. Call begin() first.');
    }
    return this._sessionInfo;
  }
}

function getState(error?: ErrorDetails): State {
  if (error) {
    return isAbortedError(error) ? 'ABORTED' : 'FAILED';
  }
  return 'SUCCEEDED';
}

function isAbortedError(error?: ErrorDetails) {
  if (error?.name === 'ToolkitError' && error?.message?.includes(ABORTED_ERROR_MESSAGE)) {
    return true;
  }
  return false;
}

function mutable<A extends object>(x: A): { -readonly [k in keyof A]: A[k] } {
  return x;
}

/**
 * Validates that the CDK_CLI_USERAGENT env var value matches
 * the expected format: `<name>/<version>/<mode>` where name is one of
 * VALID_USER_AGENTS and mode is either `sandbox` or `production`.
 */
export function isValidWrapperUserAgent(value: string | undefined): value is string {
  if (!value) return false;
  const parts = value.split('/');
  if (parts.length !== 3) return false;
  const [name, _version, mode] = parts;
  if (!VALID_USER_AGENTS.includes(name)) return false;
  return mode === 'sandbox' || mode === 'production';
}
