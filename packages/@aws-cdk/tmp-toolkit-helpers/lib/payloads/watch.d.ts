/**
 * The computed file watch settings
 */
export interface WatchSettings {
    /**
     * The directory observed for file changes
     */
    readonly watchDir: string;
    /**
     * List of include patterns for watching files
     */
    readonly includes: string[];
    /**
     * List of excludes patterns for watching files
     */
    readonly excludes: string[];
}
export interface FileWatchEvent {
    /**
     * The change to the path
     */
    readonly event: string;
    /**
     * The path that has an observed event
     */
    readonly path?: string;
}
