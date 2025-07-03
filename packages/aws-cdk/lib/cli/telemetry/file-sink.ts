import * as fs from 'fs';
import * as path from 'path';
import { ToolkitError, type IIoHost } from '@aws-cdk/toolkit-lib';
import type { TelemetrySchema } from './schema';
import type { ITelemetrySink } from './sink-interface';
import { IoHelper } from '../../api-private';

/**
 * Properties for the FileTelemetryClient
 */
export interface FileTelemetrySinkProps {
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
export class FileTelemetrySink implements ITelemetrySink {
  private ioHelper: IoHelper;
  private logFilePath: string;

  /**
   * Create a new FileTelemetryClient
   */
  constructor(props: FileTelemetrySinkProps) {
    this.ioHelper = IoHelper.fromActionAwareIoHost(props.ioHost);
    this.logFilePath = props.logFilePath;

    if (fs.existsSync(this.logFilePath)) {
      throw new ToolkitError(`Telemetry file already exists at ${this.logFilePath}`);
    }

    // Create the file if necessary
    const directory = path.dirname(this.logFilePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }

  /**
   * Emit an event.
   */
  public async emit(event: TelemetrySchema): Promise<void> {
    try {
      // Format the events as a JSON string with pretty printing
      const output = JSON.stringify(event, null, 2);

      // Write to file
      fs.appendFileSync(this.logFilePath, output);
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHelper.defaults.trace(`Failed to add telemetry event: ${e.message}`);
    }
  }

  public async flush(): Promise<void> {
    return;
  }
}
