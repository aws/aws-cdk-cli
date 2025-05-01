/**
 * Find the package.json from the main toolkit.
 *
 * If we can't read it for some reason, try to do something reasonable anyway.
 * Fall back to argv[1], or a standard string if that is undefined for some reason.
 */
export declare function defaultCliUserAgent(): string;
