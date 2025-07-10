import { randomUUID } from 'crypto';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { getInstallationId } from './installation-id';
import { getLibraryVersion } from './library-version';
import { sanitizeCommandLineArguments, sanitizeContext } from './sanitation';
import type { EventType, SessionSchema, State, ErrorDetails } from './schema';
import type { ITelemetrySink } from './sink-interface';
import type { Context } from '../../api/context';
import type { IMessageSpan } from '../../api-private';
import { detectCiSystem } from '../ci-systems';
import type { CliIoHost } from '../io-host/cli-io-host';
import type { EventResult } from '../telemetry/messages';
import { CLI_PRIVATE_SPAN } from '../telemetry/messages';
import { isCI } from '../util/ci';
import { versionNumber } from '../version-util';

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
    this.span = await this.ioHost.asIoHelper().span(CLI_PRIVATE_SPAN.COMMAND).begin({});

    // sanitize the raw cli input
    const { path, parameters } = sanitizeCommandLineArguments(this.props.arguments);
    this._sessionInfo = {
      identifiers: {
        installationId: await getInstallationId(this.ioHost.asIoHelper()),
        sessionId: randomUUID(),
        telemetryVersion: '1.0',
        cdkCliVersion: versionNumber(),
        cdkLibraryVersion: await getLibraryVersion(this.ioHost.asIoHelper()),
      },
      event: {
        command: {
          path,
          parameters,
          config: sanitizeContext(this.props.context),
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
      await this.end({
        name: 'ToolkitError',
        message: 'Subprocess exited with error null',
      });
    });
  }

  public async attachRegion(region: string) {
    this.sessionInfo.identifiers = {
      ...this.sessionInfo.identifiers,
      region,
    };
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
      ...( event.error ? {
        error: {
          name: event.error.name,
        },
      } : {}),
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
  if (error?.name === 'ToolkitError' && error?.message?.includes('Subprocess exited with error null')) {
    return true;
  }
  return false;
}
