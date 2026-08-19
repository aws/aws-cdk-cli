import * as fs from 'node:fs';
import type { TelemetrySenderConfig } from './sender';
import { sendTelemetry, trace } from './sender';

/**
 * Entry point for the detached telemetry sender.
 *
 * This file is a dedicated esbuild entry point (see `BundleCli` in `.projenrc.ts`), so it is
 * self-contained in the published package and free to use the CLI's real dependencies -- notably
 * `proxy-agent`, which is what gives the child the same proxy support the parent has.
 *
 * It is spawned directly, detached, by `sink/subprocess-sink.ts`, with the path to a payload file
 * as its only argument. It reads that file, deletes it, POSTs the contents, and exits.
 */

/**
 * Upper bound on the lifetime of this process.
 *
 * A TCP connection that neither completes nor errors would otherwise keep a detached process alive
 * indefinitely after the CLI has exited. The timer is `unref`ed so it never keeps the process alive
 * by itself, but it still fires if something else does.
 *
 * Must exceed the sender's own network budget so that it stays a backstop against a genuinely stuck
 * socket rather than something that can fire during a slow-but-progressing handshake.
 */
const HARD_KILL_MS = 30_000;

/**
 * Read the payload file and delete it, whether or not reading worked.
 *
 * The file is ours alone -- the parent wrote it for this process and nothing else will collect it --
 * so leaving it behind on a failure would leak a file into the temp directory on every invocation.
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
      // Nothing useful to do about it; the OS cleans its own temp directory.
    }
  }
}

async function main(): Promise<void> {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    trace('No payload path was given, nothing to send');
    return;
  }

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

  const result = await sendTelemetry(cfg);
  trace(result.sent
    ? `Telemetry sent (${result.statusCode})`
    : `Telemetry not sent: ${result.reason}`);
}

const hardKill = setTimeout(() => process.exit(0), HARD_KILL_MS);
hardKill.unref();

// Always exit 0: nobody reads this process's status, and a non-zero exit would only make a failed
// telemetry delivery look like a crashed CLI to anyone watching.
void main().then(
  () => {
    clearTimeout(hardKill);
    process.exit(0);
  },
  () => {
    clearTimeout(hardKill);
    process.exit(0);
  },
);
