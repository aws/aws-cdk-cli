/**
 * Our own execute function which doesn't use shells and strings.
 */
export declare function exec(commandLine: string[], options?: {
    cwd?: string;
    verbose?: boolean;
    env?: any;
}): any;
/**
 * Flatten a list of lists into a list of elements
 */
export declare function flatten<T>(xs: T[][]): T[];
/**
 * Chain commands
 */
export declare function chain(commands: string[]): string;
/**
 * Split command to chunks by space
 */
export declare function chunks(command: string): string[];
/**
 * A class holding a set of items which are being crossed off in time
 *
 * If it takes too long to cross off a new item, print the list.
 */
export declare class WorkList<A> {
    private readonly items;
    private readonly options;
    private readonly remaining;
    private readonly timeout;
    private timer?;
    constructor(items: A[], options?: WorkListOptions<A>);
    crossOff(item: A): void;
    done(): void;
    private stopTimer;
    private scheduleTimer;
    private report;
}
export interface WorkListOptions<A> {
    /**
     * When to reply with remaining items
     *
     * @default 60000
     */
    readonly timeout?: number;
    /**
     * Function to call when timeout hits
     */
    readonly onTimeout?: (x: Set<A>) => void;
}
