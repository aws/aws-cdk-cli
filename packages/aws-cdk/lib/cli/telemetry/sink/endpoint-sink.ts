import type { IncomingMessage } from 'http';
import type { Agent } from 'https';
import { request } from 'https';
import { parse, type UrlWithStringQuery } from 'url';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { IoHelper } from '../../../api-private';
import type { IIoHost } from '../../io-host';
import type { TelemetrySchema } from '../schema';
import type { ITelemetrySink } from '../sink-interface';

const REQUEST_ATTEMPT_TIMEOUT_MS = 500;

/**
 * Properties for the Endpoint Telemetry Client
 */
export interface EndpointTelemetrySinkProps {
  /**
   * The external endpoint to hit
   */
  readonly endpoint: string;

  /**
   * Where messages are going to be sent
   */
  readonly ioHost: IIoHost;

  /**
   * The agent responsible for making the network requests.
   *
   * Use this to set up a proxy connection.
   *
   * @default - Uses the shared global node agent
   */
  readonly agent?: Agent;
}

/**
 * The telemetry client that hits an external endpoint.
 */
export class EndpointTelemetrySink implements ITelemetrySink {
  private events: TelemetrySchema[] = [];
  private endpoint: UrlWithStringQuery;
  private ioHelper: IoHelper;
  private agent?: Agent;

  public constructor(props: EndpointTelemetrySinkProps) {
    this.endpoint = parse(props.endpoint);
    this.ioHelper = IoHelper.fromActionAwareIoHost(props.ioHost);
    this.agent = props.agent;

    // Batch events every 30 seconds
    setInterval(() => this.flush(), 30000).unref();
  }

  /**
   * Add an event to the collection.
   */
  public async emit(event: TelemetrySchema): Promise<void> {
    try {
      this.events.push(event);
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHelper.defaults.trace(`Failed to add telemetry event: ${e.message}`);
    }
  }

  public async flush(): Promise<void> {
    try {
      if (this.events.length === 0) {
        return;
      }

      const res = await this.https(this.endpoint, { events: this.events });

      // Clear the events array after successful output
      if (res) {
        this.events = [];
      }
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHelper.defaults.trace(`Failed to add telemetry event: ${e.message}`);
    }
  }

  /**
   * Returns true if telemetry successfully posted, false otherwise.
   */
  private async https(
    url: UrlWithStringQuery,
    body: { events: TelemetrySchema[] },
  ): Promise<boolean> {
    try {
      const res = await doRequest(url, body, this.agent);

      // Successfully posted
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        return true;
      }

      await this.ioHelper.defaults.trace(`Telemetry Unsuccessful: POST ${url.hostname}${url.pathname}: ${res.statusCode}:${res.statusMessage}`);

      return false;
    } catch (e: any) {
      await this.ioHelper.defaults.trace(`Telemetry Error: POST ${url.hostname}${url.pathname}: ${JSON.stringify(e)}`);
      return false;
    }
  }
}

/**
 * A Promisified version of `https.request()`
 */
function doRequest(
  url: UrlWithStringQuery,
  data: { events: TelemetrySchema[] },
  agent?: Agent,
) {
  return new Promise<IncomingMessage>((ok, ko) => {
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
      agent,
      timeout: REQUEST_ATTEMPT_TIMEOUT_MS,
    }, ok);

    req.on('error', ko);
    req.on('timeout', () => {
      const error = new ToolkitError(`Timeout after ${REQUEST_ATTEMPT_TIMEOUT_MS}ms, aborting request`);
      req.destroy(error);
    });

    req.end(payload);
  });
}
