import type { IoMessageLevel } from '../';

/**
 * Keep this list ordered from most to least verbose.
 * Every level "includes" all of the levels below it.
 * This is used to compare levels of messages to determine what should be logged.
 */
const levels = [
  'trace',
  'debug',
  'info',
  'warn',
  'result',
  'error',
] as const;

// compare levels helper
// helper to convert the array into a map with numbers
const orderedLevels: Record<typeof levels[number], number> = Object.fromEntries(Object.entries(levels).map(a => a.reverse()));
function compareFn(a: IoMessageLevel, b: IoMessageLevel): number {
  return orderedLevels[a] - orderedLevels[b];
}

/**
 * Determines if a message is relevant for the given log level.
 *
 * @param msg The message to compare.
 * @param level The level to compare against.
 * @returns true if the message is relevant for the given level.
 */
export function isMessageRelevantForLevel(msg: { level: IoMessageLevel }, level: IoMessageLevel): boolean {
  return compareFn(msg.level, level) >= 0;
}

