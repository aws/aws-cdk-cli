import { request } from 'https';
import type { UrlWithStringQuery } from 'url';
import { IoHelper } from '../../api-private';
import type { IIoHost } from '../io-host';
import type { ITelemetryClient } from './client-interface';
import type { TelemetrySchema } from './schema';
import { IncomingMessage } from 'http';

const REQUEST_DEADLINE_MS = 5_000;

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
      await this.https(this.endpoint, this.events);

      // Clear the events array after successful output
      this.events = [];
    } catch (e: any) {
      // Never throw errors, just log them via ioHost
      await this.ioHost.defaults.warn(`Failed to flush telemetry events: ${e.message}`);
    }
  }

  private async https(
    url: UrlWithStringQuery,
    body: TelemetrySchema[],
  ): Promise<void> {
    const deadline = Date.now() + REQUEST_DEADLINE_MS;
    let maxDelay = 100;
    while (true) {
      try {
        const res = await requestPromise(url, body);
        // eslint-disable-next-line
        console.log(res);

        if (res.statusCode == null) {
          throw new RetryableError('No status code available');
        }

        // Server errors. We can't know whether these are really retryable but we usually pretend that they are.
        if (res.statusCode >= 500 && res.statusCode < 600) {
          throw new RetryableError(`HTTP ${res.statusCode} ${res.statusMessage}`);
        }

        // Permanent (client) errors:
        if (res.statusCode >= 400 && res.statusCode < 500) {
          throw new Error(`HTTP ${res.statusCode} ${res.statusMessage}`);
        }

        return;
      } catch (e: any) {
        if (Date.now() > deadline || !isRetryableError(e)) {
          this.ioHost.defaults.debug(`Fatal Telemetry Error: POST ${url}: ${e}`);
          return;
        }
        this.ioHost.defaults.debug(`Retryable Telemetry Error: POST ${url}: ${e}`);

        await sleep(Math.floor(Math.random() * maxDelay));
        maxDelay *= 2;
      }
    }
  }
}

/**
 * A Promisified version of `https.request()`
 */
function requestPromise(
  url: UrlWithStringQuery,
  data: TelemetrySchema[],
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
      timeout: REQUEST_ATTEMPT_TIMEOUT_MS,
    }, ok);

    req.on('error', ko);
    req.on('timeout', () => {
      const error = new RetryableError(`Timeout after ${REQUEST_ATTEMPT_TIMEOUT_MS}ms, aborting request`);
      req.destroy(error);
    });

    req.end(payload);
  });
}

class RetryableError extends Error {}

function isRetryableError(e: Error): boolean {
  return e instanceof RetryableError || (e as any).code === 'ECONNRESET';
}

async function sleep(ms: number) {
  return new Promise((ok) => setTimeout(ok, ms));
}
