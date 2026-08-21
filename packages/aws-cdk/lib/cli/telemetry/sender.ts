import * as fs from 'node:fs';
import type { TelemetryBatch } from './post-telemetry';
import { postTelemetry } from './post-telemetry';
import { ToolkitError } from '../../toolkit-error';
import type { ProxyAgentDiagnostics } from '../proxy-agent';
import { ProxyAgentProvider } from '../proxy-agent';

/**
 * Budget for the delivery attempt.
 *
 * Generous because nothing is waiting on it: this process is detached and the CLI has already exited,
 * so the only thing a longer timeout costs is a background process living a little longer. It has to
 * cover a proxy handshake plus the POST on a loaded machine.
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
   * Proxy to route through. An empty string means "explicitly no proxy", as `--proxy ''` does.
   *
   * @default - resolved from the inherited proxy environment variables, as in the parent
   */
  readonly proxyUrl?: string;

  /**
   * Absolute path to a CA bundle to trust. The path, not the contents: a system bundle is ~190KB.
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
 * POST a telemetry payload, routing through a proxy when one applies.
 *
 * Returns the status code for the caller to judge, and lets failures reject: every outcome is handled
 * in one place, in the entry point.
 */
export async function sendTelemetry(cfg: TelemetrySenderConfig): Promise<number | undefined> {
  if (!cfg?.endpoint) {
    throw new ToolkitError('NoEndpoint', 'No telemetry endpoint was given');
  }

  const url = new URL(cfg.endpoint);

  // The provider the CLI itself uses, so the child routes the way the parent would have, including
  // SOCKS and PAC proxies and NO_PROXY from the inherited environment.
  const { agent } = await new ProxyAgentProvider(senderDiagnostics).create({
    proxyAddress: cfg.proxyUrl,
    caBundlePath: cfg.caBundlePath,
  });

  const res = await postTelemetry(url, cfg.body ?? { events: [] }, {
    agent,
    timeoutMs: cfg.timeoutMs ?? NETWORK_TIMEOUT_MS,
  });

  // Drain, or the socket is never released.
  res.resume();

  return res.statusCode;
}

export function isSuccess(statusCode: number | undefined): boolean {
  return statusCode !== undefined && statusCode >= 200 && statusCode < 300;
}

/**
 * Diagnostics for the detached child, which has no IoHost.
 */
export const senderDiagnostics: ProxyAgentDiagnostics = {
  defaults: {
    debug: async (message: string) => trace(message),
  },
};

/**
 * Only visible when the parent was run with `CDK_TELEMETRY_SENDER_DEBUG=1`, which is also what makes
 * it pass this process's stderr through. Synchronous because `process.exit` discards buffered writes.
 */
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
