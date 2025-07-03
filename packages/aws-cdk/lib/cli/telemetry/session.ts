import { randomUUID } from 'crypto';
import { IMessageSpan } from '../../api-private';
import { Context } from '../../api/context';
import { CLI_PRIVATE_SPAN, CliIoHost, EventResult, isCI, } from '../io-host';
import { getInstallationId } from './installation-id';
import { IoHostTelemetryClient } from './io-host-client';
import { sanitizeCommandLineArguments, sanitizeContext } from './sanitation-utils';
import type { EventType, SessionSchema, State, ErrorDetails } from './schema';
import type { ITelemetrySink } from './sink-interface';
import { versionNumber } from '../version-util';
import { detectCiSystem } from '../ci-systems';
import { AccountIdFetcher } from './account-id-fetcher';
import { getLibraryVersion } from './library-version';
import { RegionFetcher } from './region-fetcher';
import { ToolkitError } from '@aws-cdk/toolkit-lib';

export interface TelemetrySessionProps {
  readonly ioHost: CliIoHost;
  readonly arguments: any;
  readonly context: Context;
}

interface TelemetryEvent {
  readonly eventType: EventType;
  readonly duration: number;
  readonly error?: ErrorDetails;
}

export class TelemetrySession {
  private readonly ioHost: CliIoHost;
  private _client?: ITelemetrySink;
  private _sessionInfo?: SessionSchema;
  private span?: IMessageSpan<EventResult>;
  private count = 0;

  constructor(private readonly props: TelemetrySessionProps) {
    this.ioHost = props.ioHost;
  }

  public async begin() {
    this.span = await this.ioHost.asIoHelper().span(CLI_PRIVATE_SPAN.COMMAND).begin({});

    // TODO: change this to EndpointTelemetryClient
    this._client = new IoHostTelemetryClient({
      ioHost: this.ioHost,
    });

    // sanitize the raw cli input
    const command = sanitizeCommandLineArguments(this.props.arguments);
    this._sessionInfo = {
      identifiers: {
        installationId: getInstallationId(this.ioHost.asIoHelper()),
        sessionId: randomUUID(),
        telemetryVersion: '1.0',
        cdkCliVersion: versionNumber(),
        cdkLibraryVersion: await getLibraryVersion(this.ioHost.asIoHelper()),
        accountId: await new AccountIdFetcher().fetch(),
        region: await new RegionFetcher().fetch(),
      },
      event: {
        command: {
          path: command.path,
          parameters: command.parameters,
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

    // connect ctrl-c to ABORT event
    process.on('SIGINT', async () => {
      // Send a special Error
      await this.end({
        name: 'AbortedError',
      });
    });
  }

  /**
   * When the command is complete, so is the CliIoHost. Ends the span of the entire CliIoHost
   * and notifies with an optional error message in the data.
   */
  public async end(error?: ErrorDetails) {
    await this.span?.end({ error });
    await this.client.flush();
  }

  public async emit(event: TelemetryEvent): Promise<boolean> {
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

  private get client(): ITelemetrySink {
    if (!this._client) {
      throw new ToolkitError('Client not initialized. Call begin() first.');
    }
    return this._client;
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
    return error.name === 'AbortedError' ? 'ABORTED' : 'FAILED';
  }
  return 'SUCCEEDED';
}
