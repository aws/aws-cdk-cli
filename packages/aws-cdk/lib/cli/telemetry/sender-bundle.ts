import * as fs from 'node:fs';
import type { TelemetrySenderConfig } from './sender';
import { isSuccess, sendTelemetry, trace } from './sender';

/**
 * Entry point for the detached telemetry sender.
 *
 * A dedicated esbuild entry point (see `BundleCli` in `.projenrc.ts`) so it stands on its own in the
 * published package, where `dependencies` are stripped -- which is what lets it use the real
 * `proxy-agent`. Spawned detached by `sink/subprocess-sink.ts` with a payload file path as its only
 * argument.
 */

/**
 * Backstop for a socket that neither completes nor errors. `unref`ed, so it never keeps the process
 * alive by itself; must exceed the sender's own network budget.
 */
const HARD_KILL_MS = 30_000;

/**
 * Read the payload file and delete it either way: it was written for this process alone, so leaving
 * it behind would leak one file per invocation.
 */
function takePayload(payloadPath: string): string | undefined {
  try {
    return fs.readFileSync(payloadPath, 'utf-8');
  } catch (e: any) {
    trace(`Could not read payload from ${payloadPath}: ${e?.message}`);
    return undefined;
  } finally {
    try {
      fs.unlinkSync(payloadPath);
    } catch {
      // The OS cleans its own temp directory.
    }
  }
}

/**
 * Deliver one payload.
 *
 * The single place delivery outcomes are handled: failures arrive as rejections, and a non-2xx is
 * judged here rather than deeper down.
 */
async function deliver(payloadPath: string): Promise<void> {
  const raw = takePayload(payloadPath);
  if (raw === undefined) {
    return;
  }

  let cfg: TelemetrySenderConfig;
  try {
    cfg = JSON.parse(raw) as TelemetrySenderConfig;
  } catch (e: any) {
    trace(`Malformed payload: ${e?.message}`);
    return;
  }

  try {
    const statusCode = await sendTelemetry(cfg);
    const ok = isSuccess(statusCode);
    trace(ok ? `Telemetry sent (${statusCode})` : `Telemetry rejected with ${statusCode}`);
  } catch (e: any) {
    trace(`Telemetry not sent: ${e?.code ?? e?.name ?? 'Error'}: ${e?.message}`);
  }
}

async function main(): Promise<void> {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    trace('No payload path was given, nothing to send');
    return;
  }
  await deliver(payloadPath);
}

const hardKill = setTimeout(() => process.exit(0), HARD_KILL_MS);
hardKill.unref();

// Always exit 0: nobody reads this status, and a non-zero exit would make a failed delivery look
// like a crashed CLI.
const done = () => {
  clearTimeout(hardKill);
  process.exit(0);
};
void main().then(done, done);
