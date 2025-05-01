import type { IIoHost } from '../io-host';
import type { IoMessage, IoRequest } from '../io-message';
import type { ToolkitAction } from '../toolkit-action';
import type { SpanEnd, SpanDefinition } from './span';
import { SpanMaker } from './span';
export type ActionLessMessage<T> = Omit<IoMessage<T>, 'action'>;
export type ActionLessRequest<T, U> = Omit<IoRequest<T, U>, 'action'>;
/**
 * A class containing helper tools to interact with IoHost
 */
export declare class IoHelper implements IIoHost {
    static fromIoHost(ioHost: IIoHost, action: ToolkitAction): IoHelper;
    private readonly ioHost;
    private readonly action;
    private constructor();
    /**
     * Forward a message to the IoHost, while injection the current action
     */
    notify(msg: ActionLessMessage<unknown>): Promise<void>;
    /**
     * Forward a request to the IoHost, while injection the current action
     */
    requestResponse<T, U>(msg: ActionLessRequest<T, U>): Promise<U>;
    /**
     * Create a new marker from a given registry entry
     */
    span<S extends object, E extends SpanEnd>(definition: SpanDefinition<S, E>): SpanMaker<S, E>;
}
/**
 * Wraps an IoHost and creates an IoHelper from it
 */
export declare function asIoHelper(ioHost: IIoHost, action: ToolkitAction): IoHelper;
