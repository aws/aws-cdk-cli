import { request } from 'https';
import { IIoHost } from '../io-host';
import { IoHelper } from '../../api-private';
import { ITelemetryClient } from './client-interface';

/**
 * Properties for the Endpoint Telemetry Client
 */
export interface EndpointTelemetryClientProps {
  /**
   * The external endpoint to hit
   */
  readonly endpoint: URL;

  /**
   * Where messages are going to be sent
   */
  readonly ioHost: IIoHost;
}

/**
 * The telemetry client that hits an external endpoint. 
 */
export class EndpointTelemetryClient<T> implements ITelemetryClient<T> {
  private events: T[] = [];
  private endpoint: URL;
  private ioHost: IoHelper;

  public constructor(props: EndpointTelemetryClientProps) {
    this.endpoint = props.endpoint;
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

  public async flush() {
    if (this.events.length === 0) {
      return;
    }

    try {
      this.https(this.endpoint, this.events);

      // Clear the events array after successful output
      this.events = [];
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHost.defaults.warn(`Failed to flush telemetry events: ${e.message}`);
    }
  }

  private async https(
    url: URL,
    body: any, // to be schema
  ): Promise<void> {
    // TODO: Handle retries and stuff
    return requestPromise(url, body);
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
