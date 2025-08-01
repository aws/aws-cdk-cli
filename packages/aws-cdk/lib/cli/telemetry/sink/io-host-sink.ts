import type { IIoHost } from '@aws-cdk/toolkit-lib';
import { IoHelper } from '../../../api-private';
import type { TelemetrySchema } from '../schema';
import type { ITelemetrySink } from './sink-interface';

/**
 * Properties for the StdoutTelemetryClient
 */
export interface IoHostTelemetrySinkProps {
  /**
   * Where messages are going to be sent
   */
  readonly ioHost: IIoHost;
}

/**
 * A telemetry client that collects events and flushes them to stdout.
 */
export class IoHostTelemetrySink implements ITelemetrySink {
  private ioHelper: IoHelper;

  /**
   * Create a new StdoutTelemetryClient
   */
  constructor(props: IoHostTelemetrySinkProps) {
    this.ioHelper = IoHelper.fromActionAwareIoHost(props.ioHost);
  }

  /**
   * Emit an event
   */
  public async emit(event: TelemetrySchema): Promise<void> {
    try {
      // Format the events as a JSON string with pretty printing
      const output = JSON.stringify(event, null, 2);

      // Write to IoHost
      await this.ioHelper.defaults.trace(`--- TELEMETRY EVENT ---\n${output}\n-----------------------\n`);
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHelper.defaults.trace(`Failed to add telemetry event: ${e.message}`);
    }
  }

  public async flush(): Promise<void> {
    return;
  }
}
