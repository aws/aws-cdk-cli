import { randomUUID } from 'crypto';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { getOrCreateInstallationId } from './installation-id';
import { getLibraryVersion } from './library-version';
import { sanitizeCommandLineArguments, sanitizeContext } from './sanitation';
import { type EventType, type SessionSchema, type State, type ErrorDetails, ErrorName } from './schema';
import type { ITelemetrySink } from './sink/sink-interface';
import type { Context } from '../../api/context';
import type { IMessageSpan } from '../../api-private';
import { detectCiSystem } from '../ci-systems';
import type { CliIoHost } from '../io-host/cli-io-host';
import type { EventResult } from '../telemetry/messages';
import { CLI_PRIVATE_SPAN } from '../telemetry/messages';
import { isCI } from '../util/ci';
import { versionNumber } from '../version';

const ABORTED_ERROR_MESSAGE = '__CDK-Toolkit__Aborted';

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
  counters?: Record<string, number>;
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
  private span?: IMessageSpan<EventResult>;
  private count = 0;

  constructor(private readonly props: TelemetrySessionProps) {
    this.ioHost = props.ioHost;
    this.client = props.client;
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
          name: ErrorName.TOOLKIT_ERROR,
          message: ABORTED_ERROR_MESSAGE,
        });
      } catch (e: any) {
        await this.ioHost.defaults.trace(`Ending Telemetry failed: ${e.message}`);
      }
      process.exit(1);
    });

    // Begin the session span
    this.span = await this.ioHost.asIoHelper().span(CLI_PRIVATE_SPAN.COMMAND).begin({});
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
    await this.span?.end({ error });
    // Ideally span.end() should no-op if called twice, but that is not the case right now
    this.span = undefined;
    await this.client.flush();
  }

  public async emit(event: TelemetryEvent): Promise<void> {
    this.count += 1;

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
      ...(event.counters && Object.keys(event.counters).length > 0 ? { counters: event.counters } : {}),
    });
  }

  private get sessionInfo(): SessionSchema {
    if (!this._sessionInfo) {
      throw new ToolkitError('Session Info not initialized. Call begin() first.');
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