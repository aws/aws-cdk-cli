import { request } from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { IIoHost } from '../io-host';
import { IoHelper } from '../../api-private';

/**
 * Properties for the Telemetry Client
 */
export interface TelemetryClientProps {
  /**
   * The external endpoint to hit
   */
  readonly endpoint: URL;

  /**
   * The local file to log telemetry data to.
   * If not specified, then local logging does not take place.
   */
  readonly logFilePath?: string;

  /**
   * Where messages are going to be sent
   */
  readonly ioHost: IIoHost;
}

/**
 * The telemetry client. 
 */
export class TelemetryClient {
  private endpoint: URL;
  private logFilePath?: string;
  private ioHost: IoHelper;

  public constructor(props: TelemetryClientProps) {
    this.endpoint = props.endpoint;
    this.logFilePath = props.logFilePath;
    this.ioHost = IoHelper.fromActionAwareIoHost(props.ioHost);

    // Create the file if necessary
    if (this.logFilePath) {
      const directory = path.dirname(this.logFilePath);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }
      // Clear the log file
+     fs.writeFileSync(this.logFilePath, '');
    }
  }

  // TODO: data needs to be strongly typed as our schema
  /**
   * Send the data to the endpoint in a fire-and-forget action.
   * Stores the data locally as a log for future reference.
   */
  public async sendData(data: any) {
    // Save data locally first
    await this.saveData(data);
    // Then send it to the endpoint
    return this.https(this.endpoint, data);
  }

  private async https(
    url: URL,
    body: any, // to be schema
  ): Promise<void> {
    // TODO: Handle retries and stuff
    return requestPromise(url, body);
  }

  private async saveData(data: any): Promise<void> {
    if (this.logFilePath) {
      fs.appendFile(this.logFilePath, JSON.stringify(data, null, 2), async (err) => {
        if (err) {
          await this.ioHost.defaults.warn(`Telemetry Logging Failed: ${err.message}`);
        }
      });
    }
  }
}

/**
 * A Promisified version of `https.request()`
 */
function requestPromise(
  url: URL,
  data: any // to be schema
) {
  return new Promise<void>((resolve) => {
    const payload: string = JSON.stringify(data);
    const req = request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
      },
    });
    req.on('error', () => {
      /* noop */
    });
    req.setTimeout(2000, () => {
      // 2 seconds
      resolve();
    });

    req.write(payload);
    req.end(() => {
      resolve();
    });
  });
}
