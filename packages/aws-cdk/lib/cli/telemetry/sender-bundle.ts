import * as fs from 'node:fs';
import { recordLastSend } from './last-send';
import type { TelemetrySenderConfig } from './sender';
import { isSuccess, sendTelemetry, trace } from './sender';

/**
 * Entry point for the detached telemetry sender.
 *
 * A dedicated esbuild entry point (see `BundleCli` in `.projenrc.ts`) so that it stands on its own in
 * the published package, where `dependencies` are stripped. That is what lets it use the real
 * `proxy-agent` rather than hand-rolling proxy support out of Node built-ins.
 *
 * Spawned detached by `sink/subprocess-sink.ts` with the path to a payload file as its only argument.
 * Reads that file, deletes it, POSTs the contents, records the outcome, and exits.
 */

/**
 * Upper bound on the lifetime of this process, in case a socket neither completes nor errors.
 *
 * `unref`ed, so it never keeps the process alive by itself. Must exceed the sender's own network
 * budget so it stays a backstop rather than something that fires mid-handshake.
 */
const HARD_KILL_MS = 30_000;

/**
 * Read the payload file and delete it, whether or not reading worked.
 *
 * The file was written for this process alone, so leaving it behind on failure would leak one file
 * per invocation.
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
 * Deliver one payload and leave a breadcrumb saying how it went.
 *
 * The single place every delivery outcome is handled: `sendTelemetry` reports failures by rejecting,
 * and a non-2xx is judged here rather than deeper down.
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
    recordLastSend({ ok: false, reason: `MalformedPayload: ${e?.message}`, at: new Date().toISOString() });
    return;
  }

  try {
    const statusCode = await sendTelemetry(cfg);
    const ok = isSuccess(statusCode);
    recordLastSend({
      ok,
      statusCode,
      ...ok ? {} : { reason: `UnexpectedStatusCode: ${statusCode}` },
      at: new Date().toISOString(),
    });
    trace(ok ? `Telemetry sent (${statusCode})` : `Telemetry rejected with ${statusCode}`);
  } catch (e: any) {
    const reason = `${e?.code ?? e?.name ?? 'Error'}: ${e?.message}`;
    recordLastSend({ ok: false, reason, at: new Date().toISOString() });
    trace(`Telemetry not sent: ${reason}`);
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

// Always exit 0: nobody reads this process's status, and a non-zero exit would only make a failed
// telemetry delivery look like a crashed CLI to anyone watching.
const done = () => {
  clearTimeout(hardKill);
  process.exit(0);
};
void main().then(done, done);
