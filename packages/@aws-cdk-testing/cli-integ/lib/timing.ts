/**
 * Duration reporting for the integ test log.
 *
 * Every command run through `shell()` reports how long it took. Operations that
 * do real work *without* spawning a process (recursive copies, directory walks,
 * waiting on another worker) need to report themselves, or they show up as
 * unexplained gaps in a test's duration. This matters most on Windows, where
 * writing and deleting many small files is far slower than on Linux.
 *
 * Both helpers use the same '💻' / '⏱️' line shape as `shell()`, so a single
 * search for '⏱️' in a test log finds every measured step.
 */

/**
 * Render a duration in milliseconds for humans reading the test log.
 *
 * Uses the same units as the per-test durations in the GitHub Actions summary
 * ('2m17s', '9.4s', '386ms'), so the two can be compared without converting.
 */
export function formatDuration(millis: number): string {
  if (millis < 1_000) {
    return `${millis}ms`;
  }

  if (millis < 60_000) {
    return `${(millis / 1_000).toFixed(1)}s`;
  }

  // Round to whole seconds before splitting, so we can never render '1m60s'
  const totalSeconds = Math.round(millis / 1_000);
  return `${Math.floor(totalSeconds / 60)}m${totalSeconds % 60}s`;
}

/**
 * Run an async operation, reporting how long it took.
 *
 * The duration is reported whether the operation succeeds or throws, so a step
 * that spent two minutes before failing is still visible in the log.
 */
export async function timed<A>(
  description: string,
  output: NodeJS.WritableStream | undefined,
  block: () => Promise<A>,
): Promise<A> {
  output?.write(`💻 ${description}\n`);
  const startTime = Date.now();
  try {
    return await block();
  } finally {
    output?.write(`⏱️  ${formatDuration(Date.now() - startTime)} ${description}\n`);
  }
}

/**
 * `timed`, for operations that are synchronous.
 */
export function timedSync<A>(
  description: string,
  output: NodeJS.WritableStream | undefined,
  block: () => A,
): A {
  output?.write(`💻 ${description}\n`);
  const startTime = Date.now();
  try {
    return block();
  } finally {
    output?.write(`⏱️  ${formatDuration(Date.now() - startTime)} ${description}\n`);
  }
}
