/* eslint-disable import/no-relative-packages */
import * as fs from 'node:fs';
import * as path from 'node:path';
// Deep import: the package barrel would pull the whole toolkit into the sender bundle.
import { cdkCacheDir } from '../../../../@aws-cdk/toolkit-lib/lib/util/directories';

/**
 * The result of the previous invocation's telemetry delivery.
 *
 * Delivery happens in a detached child that the CLI never waits on, so this file is the only record
 * of whether it worked. The next invocation reports it as a counter.
 */
export interface LastSendOutcome {
  /**
   * Whether the endpoint accepted the payload.
   */
  readonly ok: boolean;

  /**
   * HTTP status code, if a response was received at all.
   *
   * @default - no response was received
   */
  readonly statusCode?: number;

  /**
   * Why delivery did not succeed.
   *
   * @default - delivery succeeded
   */
  readonly reason?: string;

  /**
   * When the attempt finished, as an ISO 8601 timestamp.
   */
  readonly at: string;
}

function lastSendPath(): string {
  return path.join(cdkCacheDir(), 'telemetry-last-send.json');
}

/**
 * Record the outcome of a delivery attempt, from the detached sender just before it exits.
 *
 * Synchronous because the caller exits immediately afterwards, and silent because failing to write
 * diagnostics must never become a failure of its own.
 */
export function recordLastSend(outcome: LastSendOutcome): void {
  try {
    const file = lastSendPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(outcome), 'utf-8');
  } catch {
    // Nothing useful to do about it.
  }
}

/**
 * Read and consume the previous invocation's outcome.
 *
 * Consumed, so one failure is reported once rather than on every invocation until the next send.
 * Never throws; returns undefined if there is nothing to report.
 */
export async function takeLastSend(): Promise<LastSendOutcome | undefined> {
  const file = lastSendPath();
  try {
    const outcome = JSON.parse(await fs.promises.readFile(file, 'utf-8')) as LastSendOutcome;
    await fs.promises.unlink(file).catch(() => {
    });
    return typeof outcome?.ok === 'boolean' ? outcome : undefined;
  } catch {
    return undefined;
  }
}
