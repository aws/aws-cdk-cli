import type { ActionLessMessage, ActionLessRequest, IoHelper } from './io-helper';
/**
 * Helper class to emit standard log messages to an IoHost
 *
 * It wraps an `IoHelper`, and adds convenience methods to emit default messages
 * for the various log levels.
 */
export declare class IoDefaultMessages {
    private readonly ioHelper;
    constructor(ioHelper: IoHelper);
    notify(msg: ActionLessMessage<unknown>): Promise<void>;
    requestResponse<T, U>(msg: ActionLessRequest<T, U>): Promise<U>;
    error(input: string, ...args: unknown[]): void;
    warn(input: string, ...args: unknown[]): void;
    warning(input: string, ...args: unknown[]): void;
    info(input: string, ...args: unknown[]): void;
    debug(input: string, ...args: unknown[]): void;
    trace(input: string, ...args: unknown[]): void;
    result(input: string, ...args: unknown[]): void;
    private emitMessage;
}
