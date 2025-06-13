import { ITelemetryClient } from './client-interface';
import { IIoHost } from '@aws-cdk/toolkit-lib';
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
export class IoHostTelemetryClient<T> implements ITelemetryClient<T> {
  private events: T[] = [];
  private ioHost: IoHelper;

  /**
   * Create a new StdoutTelemetryClient
   */
  constructor(props: IoHostTelemetryClientProps) {
    this.ioHost = IoHelper.fromActionAwareIoHost(props.ioHost);
  }

  /**
   * Add an event to the collection.
   */
  public async addEvent(event: T): Promise<boolean> {
    try {
      this.events.push(event);
      return true;
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHost.defaults.warn(`Failed to add telemetry event: ${e.message}`);
      return false;
    }
  }

  /**
   * Flush all collected events to stdout.
   */
  public async flush(): Promise<void> {
    if (this.events.length === 0) {
      return;
    }

    try {
      // Format the events as a JSON string with pretty printing
      const output = JSON.stringify(this.events, null, 2);
      
      // Write to IoHost
      this.ioHost.defaults.info(`--- TELEMETRY EVENTS ---\n${output}\n-----------------------\n`);
      
      // Clear the events array after successful output
      this.events = [];
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHost.defaults.warn(`Failed to flush telemetry events: ${e.message}`);
    }
  }
}
