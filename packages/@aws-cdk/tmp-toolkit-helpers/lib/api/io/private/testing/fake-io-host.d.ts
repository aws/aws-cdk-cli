import type { IIoHost } from '../../io-host';
import type { IoMessage, IoMessageLevel, IoRequest } from '../../io-message';
/**
 * An implementation of `IIoHost` that records messages and lets you assert on what was logged
 *
 * It's like `TestIoHost`, but comes with a predefined implementation for `notify`
 * that appends all messages to an in-memory array, and comes with a helper function
 * `expectMessage()` to test for the existence of a function in that array.
 *
 * Has a public mock for `requestResponse` that you configure like any
 * other mock function.
 *
 * # How to use
 *
 * Either create a new instance of this class for every test, or call `clear()`
 * on it between runs.
 */
export declare class FakeIoHost implements IIoHost {
    messages: Array<IoMessage<unknown>>;
    requestResponse: <T, U>(msg: IoRequest<T, U>) => Promise<U>;
    constructor();
    clear(): void;
    notify(msg: IoMessage<unknown>): Promise<void>;
    expectMessage(m: {
        containing: string;
        level?: IoMessageLevel;
    }): void;
}
