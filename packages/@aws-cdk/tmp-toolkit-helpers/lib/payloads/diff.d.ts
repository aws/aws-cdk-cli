import type { Duration } from './types';
/**
 * Different types of permission related changes in a diff
 */
export declare enum PermissionChangeType {
    /**
     * No permission changes
     */
    NONE = "none",
    /**
     * Permissions are broadening
     */
    BROADENING = "broadening",
    /**
     * Permissions are changed but not broadening
     */
    NON_BROADENING = "non-broadening"
}
/**
 * Output of the diff command
 */
export interface DiffResult extends Duration {
    /**
     * Stack diff formatted as a string
     */
    readonly formattedStackDiff: string;
    /**
     * Security diff formatted as a string
     */
    readonly formattedSecurityDiff: string;
}
