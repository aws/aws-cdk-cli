import type { IncomingMessage } from 'http';
import type { Agent } from 'https';
import { request } from 'https';
import type { UrlWithStringQuery } from 'url';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { IoHelper } from '../../api-private';
import type { IIoHost } from '../io-host';
import type { ITelemetrySink } from './sink-interface';
import type { TelemetrySchema } from './schema';

const REQUEST_ATTEMPT_TIMEOUT_MS = 2_000;

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
export class EndpointTelemetryClient implements ITelemetrySink {
  private events: TelemetrySchema[] = [];
  private endpoint: UrlWithStringQuery;
  private ioHost: IoHelper;
  private agent?: Agent;

  public constructor(props: EndpointTelemetryClientProps) {
    this.endpoint = props.endpoint;
    this.ioHost = IoHelper.fromActionAwareIoHost(props.ioHost);
    this.agent = props.agent;

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

  public async flush(): Promise<void> {
    if (this.events.length === 0) {
      return;
    }

    try {
      const res = await this.https(this.endpoint, this.events);

      // Clear the events array after successful output
      if (res) {
        this.events = [];
      }
    } catch (_e: any) {
      // Never throw errors, and error message was previously logged to ioHost
    }
  }

  /**
   * Returns true if telemetry successfully posted, false otherwise.
   */
  private async https(
    url: UrlWithStringQuery,
    body: TelemetrySchema[],
  ): Promise<boolean> {
    try {
      const res = await requestPromise(url, body, this.agent);

      // Successfully posted
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        return true;
      }

      await this.ioHost.defaults.debug(`Telemetry Unsuccessful: POST ${url.hostname}${url.pathname}: ${res.statusCode}:${res.statusMessage}`);

      return false;
    } catch (e: any) {
      await this.ioHost.defaults.debug(`Telemetry Error: POST ${url.hostname}${url.pathname}: ${JSON.stringify(e)}`);
      return false;
    }
  }
}

/**
 * A Promisified version of `https.request()`
 */
function requestPromise(
  url: UrlWithStringQuery,
  data: TelemetrySchema[],
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
