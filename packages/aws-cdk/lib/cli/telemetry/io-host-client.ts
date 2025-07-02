import type { IIoHost } from '@aws-cdk/toolkit-lib';
import type { ITelemetrySink } from './sink-interface';
import type { TelemetrySchema } from './schema';
import { IoHelper } from '../../api-private';

/**
 * Properties for the StdoutTelemetryClient
 */
export interface IoHostTelemetryClientProps {
  /**
   * Where messages are going to be sent
   */
  readonly ioHost: IIoHost;
}

/**
 * A telemetry client that collects events and flushes them to stdout.
 */
export class IoHostTelemetryClient implements ITelemetrySink {
  private ioHost: IoHelper;

  /**
   * Create a new StdoutTelemetryClient
   */
  constructor(props: IoHostTelemetryClientProps) {
    this.ioHost = IoHelper.fromActionAwareIoHost(props.ioHost);
  }

  /**
   * Emit an event
   */
  public async emit(event: TelemetrySchema): Promise<boolean> {
    try {
      // Format the events as a JSON string with pretty printing
      const output = JSON.stringify(event, null, 2);

      // Write to IoHost
      await this.ioHost.defaults.info(`--- TELEMETRY EVENT ---\n${output}\n-----------------------\n`);

      return true;
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHost.defaults.warn(`Failed to add telemetry event: ${e.message}`);
      return false;
    }
  }

  public async flush(): Promise<void> {
    return;
  }
}
