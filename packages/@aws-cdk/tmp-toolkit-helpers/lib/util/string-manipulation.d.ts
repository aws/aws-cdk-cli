/**
 * Pad 's' on the left with 'char' until it is n characters wide
 */
export declare function padLeft(n: number, x: string, char?: string): string;
/**
 * Pad 's' on the right with 'char' until it is n characters wide
 */
export declare function padRight(n: number, x: string, char?: string): string;
/**
 * Formats time in milliseconds (which we get from 'Date.getTime()')
 * to a human-readable time; returns time in seconds rounded to 2
 * decimal places.
 */
export declare function formatTime(num: number): number;
/**
 * This function lower cases the first character of the string provided.
 */
export declare function lowerCaseFirstCharacter(str: string): string;
