/* eslint-disable import/no-relative-packages */
import type { IncomingMessage } from 'http';
import type { Agent } from 'https';
import { request } from 'https';
import * as tls from 'tls';
// See the note in `../proxy-agent`: the package barrel would pull the whole toolkit into the
// detached sender's bundle.
import { ToolkitError } from '../../../../@aws-cdk/toolkit-lib/lib/toolkit/toolkit-error';
import type { TelemetrySchema } from './schema';

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

  /**
   * Ask the server to close the connection once it has responded.
   *
   * Set by the detached sender, which makes exactly one request and then exits. Without it the
   * response leaves a usable keep-alive socket in the agent's pool, which outlives the request it
   * was created for.
   *
   * @default false - leave connection reuse to the agent
   */
  readonly closeConnection?: boolean;

  /**
   * Require the endpoint's certificate to cover this hostname.
   *
   * Only relevant on the proxied path. `https-proxy-agent` performs the TLS upgrade itself and does
   * not pass the destination host to `tls.connect`, so for an endpoint addressed by IP literal Node
   * has nothing to match the certificate against and the check is skipped. Naming the intended host
   * explicitly keeps identity pinned to the endpoint rather than to whatever the proxy presents.
   *
   * @default - Node's default check, i.e. against the request's own hostname
   */
  readonly verifyIdentityAgainst?: string;
}

/**
 * POST a batch of telemetry events, resolving with the endpoint's response.
 *
 * Shared by the in-process sink and the detached sender so that both speak to the endpoint
 * identically; only the agent and the timeout differ between them.
 *
 * Rejects if the connection fails or the timeout expires. It does NOT reject on an unsuccessful
 * status code -- inspect `statusCode` on the resolved response for that.
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
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...options.closeConnection ? { connection: 'close' } : {},
      },
      agent: options.agent,
      timeout: options.timeoutMs,
      ...options.verifyIdentityAgainst
        ? {
          checkServerIdentity: (_host: string, cert: tls.PeerCertificate) =>
            tls.checkServerIdentity(options.verifyIdentityAgainst!, cert),
        }
        : {},
    }, ok);

    req.on('error', ko);
    req.on('timeout', () => {
      req.destroy(new ToolkitError('RequestTimeout', `Timeout after ${options.timeoutMs}ms, aborting request`));
    });

    req.end(payload);
  });
}
