/**
 * Parses a duration string and returns the equivalent number of seconds.
 *
 * Supported formats:
 * - Xs: X seconds (e.g., "10s" = 10 seconds)
 * - Xm: X minutes (e.g., "5m" = 300 seconds)
 * - Xh: X hours (e.g., "2h" = 7200 seconds)
 * - Xd: X days (e.g., "1d" = 86400 seconds)
 *
 * @param durationPattern - A string representing a duration (e.g., "10s", "5m", "2h", "1d")
 * @returns The duration in seconds
 * @throws Error if the pattern is invalid
 */
export function durationToSeconds(durationPattern: string): number {
  // Regular expression to match a number followed by a unit
  const durationRegex = /^(\d+(?:\.\d+)?)(s|m|h|d)$/;
  const match = durationPattern.match(durationRegex);

  if (!match) {
    throw new Error(`Invalid duration pattern: ${durationPattern}. Expected format: number followed by s, m, h, or d (e.g., "10s", "5m", "2h", "1d")`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': // seconds
      return value;
    case 'm': // minutes
      return value * 60;
    case 'h': // hours
      return value * 60 * 60;
    case 'd': // days
      return value * 24 * 60 * 60;
    default:
      // This should never happen due to the regex, but TypeScript doesn't know that
      throw new Error(`Unsupported time unit: ${unit}`);
  }
}
