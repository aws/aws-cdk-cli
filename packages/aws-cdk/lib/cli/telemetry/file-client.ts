import { ITelemetryClient } from './client-interface';
import { IIoHost } from '@aws-cdk/toolkit-lib';
import { IoHelper } from '../../api-private';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Properties for the FileTelemetryClient
 */
export interface FileTelemetryClientProps {
  /**
   * Where messages are going to be sent
   */
  readonly ioHost: IIoHost;

  /**
   * The local file to log telemetry data to.
   */
  readonly logFilePath: string;
}

/**
 * A telemetry client that collects events writes them to a file
 */
export class FileTelemetryClient<T> implements ITelemetryClient<T> {
  private events: T[] = [];
  private ioHost: IoHelper;
  private logFilePath: string;

  /**
   * Create a new FileTelemetryClient
   */
  constructor(props: FileTelemetryClientProps) {
    this.ioHost = IoHelper.fromActionAwareIoHost(props.ioHost);
    this.logFilePath = props.logFilePath;

    // Create the file if necessary
    const directory = path.dirname(this.logFilePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    // Clear the log file
+   fs.writeFileSync(this.logFilePath, '');
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
   * Flush all collected events to a local file.
   */
  public async flush(): Promise<void> {
    if (this.events.length === 0) {
      return;
    }

    try {
      // Format the events as a JSON string with pretty printing
      const output = JSON.stringify(this.events, null, 2);
      
      // Write to file
      fs.appendFileSync(this.logFilePath, output);
      
      // Clear the events array after successful output
      this.events = [];
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHost.defaults.warn(`Failed to flush telemetry events: ${e.message}`);
    }
  }
}
