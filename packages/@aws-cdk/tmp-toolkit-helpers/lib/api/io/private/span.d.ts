import type { ActionLessMessage, IoHelper } from './io-helper';
import type { IoMessageMaker } from './message-maker';
import type { Duration } from '../../../payloads/types';
export interface SpanEnd {
    readonly duration: number;
}
/**
 * Describes a specific span
 *
 * A span definition is a pair of `IoMessageMaker`s to create a start and end message of the span respectively.
 * It also has a display name, that is used for auto-generated message text when they are not provided.
 */
export interface SpanDefinition<S extends object, E extends SpanEnd> {
    readonly name: string;
    readonly start: IoMessageMaker<S>;
    readonly end: IoMessageMaker<E>;
}
/**
 * Used in conditional types to check if a type (e.g. after omitting fields) is an empty object
 * This is needed because counter-intuitive neither `object` nor `{}` represent that.
 */
type EmptyObject = {
    [index: string | number | symbol]: never;
};
/**
 * Helper type to force a parameter to be not present of the computed type is an empty object
 */
type VoidWhenEmpty<T> = T extends EmptyObject ? void : T;
/**
 * Helper type to force a parameter to be an empty object if the computed type is an empty object
 * This is weird, but some computed types (e.g. using `Omit`) don't end up enforcing this.
 */
type ForceEmpty<T> = T extends EmptyObject ? EmptyObject : T;
/**
 * Make some properties optional
 */
type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
/**
 * Ending the span returns the observed duration
 */
interface ElapsedTime {
    readonly asMs: number;
    readonly asSec: number;
}
/**
 * A message span that can be ended and read times from
 */
export interface IMessageSpan<E extends SpanEnd> {
    /**
     * Get the time elapsed since the start
     */
    elapsedTime(): Promise<ElapsedTime>;
    /**
     * Sends a simple, generic message with the current timing
     * For more complex intermediate messages, get the `elapsedTime` and use `notify`
     */
    timing(maker: IoMessageMaker<Duration>, message?: string): Promise<ElapsedTime>;
    /**
     * Sends an arbitrary intermediate message as part of the span
     */
    notify(message: ActionLessMessage<unknown>): Promise<void>;
    /**
     * End the span with a payload
     */
    end(payload: VoidWhenEmpty<Omit<E, keyof SpanEnd>>): Promise<ElapsedTime>;
    /**
     * End the span with a payload, overwriting
     */
    end(payload: VoidWhenEmpty<Optional<E, keyof SpanEnd>>): Promise<ElapsedTime>;
    /**
     * End the span with a message and payload
     */
    end(message: string, payload: ForceEmpty<Optional<E, keyof SpanEnd>>): Promise<ElapsedTime>;
}
/**
 * Helper class to make spans around blocks of work
 *
 * Blocks are enclosed by a start and end message.
 * All messages of the span share a unique id.
 * The end message contains the time passed between start and end.
 */
export declare class SpanMaker<S extends object, E extends SpanEnd> {
    private readonly definition;
    private readonly ioHelper;
    constructor(ioHelper: IoHelper, definition: SpanDefinition<S, E>);
    /**
     * Starts the span and initially notifies the IoHost
     * @returns a message span
     */
    begin(payload: VoidWhenEmpty<S>): Promise<IMessageSpan<E>>;
    begin(message: string, payload: S): Promise<IMessageSpan<E>>;
}
export {};
