import * as fs from 'node:fs';
import type { ProxyAgentDiagnostics } from '../proxy-agent';
import { ProxyAgentProvider } from '../proxy-agent';
import type { TelemetryBatch } from './post-telemetry';
import { postTelemetry } from './post-telemetry';

/**
 * The detached telemetry sender.
 *
 * Runs in a short-lived child process that the CLI does not wait on (see `sender-bundle.ts`, the
 * bundled entry point, and `sink/subprocess-sink.ts`, which spawns it). Its only job is to POST one
 * telemetry payload and exit.
 *
 * Nothing here ever throws: telemetry must not be able to affect the CLI, and there is no IoHost to
 * report through. Every failure is swallowed and described in the returned `SendResult`.
 */

/**
 * Budget for the delivery attempt.
 *
 * Emphatically NOT the in-process sink's 500ms. That number exists to stop a blocking POST from
 * holding up the user's prompt; nobody waits on this process, so a tight budget buys the user
 * nothing and costs us telemetry -- a proxied send needs two TLS handshakes, which routinely takes
 * longer than that on a loaded CI runner.
 */
const NETWORK_TIMEOUT_MS = 10_000;

/**
 * What the parent hands to this process.
 */
export interface TelemetrySenderConfig {
  /**
   * Absolute URL to POST the telemetry payload to.
   */
  readonly endpoint: string;

  /**
   * The batch of events to deliver.
   */
  readonly body: TelemetryBatch;

  /**
   * Proxy to route through, if the user configured one explicitly.
   *
   * An empty string means "explicitly no proxy", which is how the parent represents `--proxy ''`.
   *
   * @default - resolved from the inherited proxy environment variables, as in the parent
   */
  readonly proxyUrl?: string;

  /**
   * Absolute path to a CA bundle to trust.
   *
   * The path, not the contents: a system bundle is routinely ~190KB.
   *
   * @default - the default Node trust store, plus anything in `NODE_EXTRA_CA_CERTS`
   */
  readonly caBundlePath?: string;

  /**
   * Budget for the delivery attempt, in milliseconds.
   *
   * @default 10000
   */
  readonly timeoutMs?: number;
}

/**
 * Outcome of a send attempt. Purely informational -- nothing acts on it except tests and traces.
 */
export interface SendResult {
  /**
   * Whether the endpoint accepted the payload with a 2xx response.
   */
  readonly sent: boolean;

  /**
   * HTTP status code, if a response was received at all.
   *
   * @default - no response was received
   */
  readonly statusCode?: number;

  /**
   * Why the send did not succeed.
   *
   * @default - the send succeeded
   */
  readonly reason?: string;
}

/**
 * Deliver a telemetry payload, routing through a proxy when one applies.
 *
 * Never rejects and never throws.
 */
export async function sendTelemetry(
  cfg: TelemetrySenderConfig,
  diagnostics: ProxyAgentDiagnostics = senderDiagnostics,
): Promise<SendResult> {
  try {
    if (!cfg?.endpoint) {
      return { sent: false, reason: 'NoEndpoint' };
    }

    const url = new URL(cfg.endpoint);

    // The same provider the CLI itself uses, so the child routes exactly the way the parent would
    // have -- including SOCKS and PAC proxies, and `NO_PROXY`, which it picks up from the inherited
    // environment. `proxyAddress: undefined` means "auto-detect"; an empty string means "no proxy".
    const { agent } = await new ProxyAgentProvider(diagnostics).create({
      proxyAddress: cfg.proxyUrl,
      caBundlePath: cfg.caBundlePath,
    });

    const res = await postTelemetry(url, cfg.body ?? { events: [] }, {
      agent,
      timeoutMs: cfg.timeoutMs ?? NETWORK_TIMEOUT_MS,
      closeConnection: true,
      verifyIdentityAgainst: url.hostname,
    });

    // Drain, or the socket is never released and the process lingers until the hard kill.
    res.resume();

    if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300) {
      return { sent: true, statusCode: res.statusCode };
    }
    return { sent: false, statusCode: res.statusCode, reason: `UnexpectedStatusCode: ${res.statusCode}` };
  } catch (e: any) {
    return { sent: false, reason: `${e?.code ?? e?.name ?? 'Error'}: ${e?.message}` };
  }
}

/**
 * Diagnostics for the detached child, which has no IoHost.
 *
 * stderr is discarded by the parent, so this is only visible when the sender is run by hand with
 * `CDK_TELEMETRY_SENDER_DEBUG=1`. Written synchronously: `process.stderr` is asynchronous when it
 * is a pipe, and the `process.exit(0)` that follows would discard a buffered write.
 */
export const senderDiagnostics: ProxyAgentDiagnostics = {
  defaults: {
    debug: async (message: string) => trace(message),
  },
};

export function trace(message: string): void {
  if (process.env.CDK_TELEMETRY_SENDER_DEBUG !== '1') {
    return;
  }
  try {
    fs.writeSync(2, `[cdk-telemetry-sender] ${message}\n`);
  } catch {
    // Diagnostics must never be the reason anything fails.
  }
}
