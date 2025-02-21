/**
 * Pad 's' on the left with 'char' until it is n characters wide
 */
export function padLeft(n: number, x: string, char: string = ' '): string {
  return char.repeat(Math.max(0, n - x.length)) + x;
}

/**
 * Pad 's' on the right with 'char' until it is n characters wide
 */
export function padRight(n: number, x: string, char: string = ' '): string {
  return x + char.repeat(Math.max(0, n - x.length));
}

/**
 * Formats time in milliseconds (which we get from 'Date.getTime()')
 * to a human-readable time; returns time in seconds rounded to 2
 * decimal places.
 */
export function formatTime(num: number): number {
  return roundPercentage(millisecondsToSeconds(num));
}

/**
 * Rounds a decimal number to two decimal points.
 * The function is useful for fractions that need to be outputted as percentages.
 */
function roundPercentage(num: number): number {
  return Math.round(100 * num) / 100;
}

/**
 * Given a time in milliseconds, return an equivalent amount in seconds.
 */
function millisecondsToSeconds(num: number): number {
  return num / 1000;
}
