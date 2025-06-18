import { request } from 'https';
import type { UrlWithStringQuery } from 'url';
import { IoHelper } from '../../api-private';
import type { IIoHost } from '../io-host';
import type { ITelemetryClient } from './client-interface';
import type { TelemetrySchema } from './schema';

/**
 * Properties for the Endpoint Telemetry Client
 */
export interface EndpointTelemetryClientProps {
  /**
   * The external endpoint to hit
   */
  readonly endpoint: UrlWithStringQuery;

  /**
   * Where messages are going to be sent
   */
  readonly ioHost: IIoHost;
}

/**
 * The telemetry client that hits an external endpoint.
 */
export class EndpointTelemetryClient implements ITelemetryClient {
  private events: TelemetrySchema[] = [];
  private endpoint: UrlWithStringQuery;
  private ioHost: IoHelper;

  public constructor(props: EndpointTelemetryClientProps) {
    this.endpoint = props.endpoint;
    this.ioHost = IoHelper.fromActionAwareIoHost(props.ioHost);

    // Batch events every 30 seconds
    setInterval(() => this.flush(), 30000).unref();
  }

  /**
   * Add an event to the collection.
   */
  public async emit(event: TelemetrySchema): Promise<boolean> {
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
      await this.https(this.endpoint, this.events, this.ioHost);

      // Clear the events array after successful output
      this.events = [];
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHost.defaults.warn(`Failed to flush telemetry events: ${e.message}`);
    }
  }

  private async https(
    url: UrlWithStringQuery,
    body: any, // to be schema
    ioHost: IoHelper,
  ): Promise<void> {
    // TODO: sigv4 authentication
    // TODO: Handle retries and stuff
    return requestPromise(url, body, ioHost);
  }
}

/**
 * A Promisified version of `https.request()`
 */
function requestPromise(
  url: UrlWithStringQuery,
  data: any, // to be schema
  ioHost: IoHelper,
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
    // TODO: retryable errors
    req.on('error', async (e: any) => {
      await ioHost.defaults.warn(`Telemetry endpoint request failed: ${e.message}`);
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
