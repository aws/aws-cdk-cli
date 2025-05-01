/**
 * Read a file if it exists, or return undefined
 *
 * Not async because it is used in the constructor
 */
export declare function readIfPossible(filename: string): string | undefined;
