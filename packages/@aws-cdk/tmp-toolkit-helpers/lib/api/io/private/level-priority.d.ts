import type { IoMessageLevel } from '../';
/**
 * Determines if a message is relevant for the given log level.
 *
 * @param msg The message to compare.
 * @param level The level to compare against.
 * @returns true if the message is relevant for the given level.
 */
export declare function isMessageRelevantForLevel(msg: {
    level: IoMessageLevel;
}, level: IoMessageLevel): boolean;
