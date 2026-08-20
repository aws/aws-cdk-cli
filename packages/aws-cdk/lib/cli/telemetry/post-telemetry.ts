import type { IncomingMessage } from 'http';
import type { Agent } from 'https';
import { request } from 'https';
import * as tls from 'tls';
import type { TelemetrySchema } from './schema';
import { ToolkitError } from '../../toolkit-error';

/**
 * A batch of telemetry events, as the endpoint expects to receive it.
 */
export interface TelemetryBatch {
  readonly events: TelemetrySchema[];
}

/**
 * Options for a single delivery attempt.
 */
export interface PostTelemetryOptions {
  /**
   * Agent to make the request through, carrying proxy and CA configuration.
   *
   * @default - Node's default agent, i.e. a direct connection
   */
  readonly agent?: Agent;

  /**
   * Abort the attempt if the request has not completed within this many milliseconds.
   */
  readonly timeoutMs: number;
}

/**
 * POST a batch of telemetry events, resolving with the endpoint's response.
 *
 * Rejects if the connection fails or the timeout expires, but NOT on an unsuccessful status code --
 * inspect `statusCode` for that.
 */
export function postTelemetry(
  url: URL,
  batch: TelemetryBatch,
  options: PostTelemetryOptions,
): Promise<IncomingMessage> {
  return new Promise<IncomingMessage>((ok, ko) => {
    const payload = JSON.stringify(batch);
    const req = request({
      hostname: url.hostname,
      port: url.port || null,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        // The only caller makes one request and exits, so a keep-alive socket left in the agent's
        // pool would just be something else holding the process open.
        'connection': 'close',
      },
      agent: options.agent,
      timeout: options.timeoutMs,
      // Always pin identity to the destination host. `https-proxy-agent` does the TLS upgrade itself
      // without passing that host to `tls.connect`, so for an IP-literal endpoint Node has nothing to
      // match against and skips the check entirely -- naming the host explicitly closes that hole and
      // pins to the endpoint rather than to whatever the proxy presents.
      checkServerIdentity: (_host: string, cert: tls.PeerCertificate) =>
        tls.checkServerIdentity(url.hostname, cert),
    }, ok);

    req.on('error', ko);
    req.on('timeout', () => {
      req.destroy(new ToolkitError('RequestTimeout', `Timeout after ${options.timeoutMs}ms, aborting request`));
    });

    req.end(payload);
  });
}
