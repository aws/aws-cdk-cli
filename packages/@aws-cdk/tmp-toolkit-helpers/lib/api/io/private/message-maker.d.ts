import type { IoMessage, IoMessageCode, IoMessageLevel } from '../io-message';
import type { ActionLessMessage, ActionLessRequest } from './io-helper';
/**
 * Information for each IO Message Code.
 */
interface CodeInfo {
    /**
     * The message code.
     */
    readonly code: IoMessageCode;
    /**
     * A brief description of the meaning of this IO Message.
     */
    readonly description: string;
    /**
     * The name of the payload interface, if applicable.
     * Some Io Messages include a payload, with a specific interface. The name of
     * the interface is specified here so that it can be linked with the message
     * when documentation is generated.
     *
     * The interface _must_ be exposed directly from toolkit-lib, so that it will
     * have a documentation page generated (that can be linked to).
     */
    readonly interface?: string;
}
/**
 * Information for each IO Message
 */
interface MessageInfo extends CodeInfo {
    /**
     * The message level
     */
    readonly level: IoMessageLevel;
}
/**
 * An interface that can produce messages for a specific code.
 */
export interface IoMessageMaker<T> extends MessageInfo {
    /**
     * Create a message for this code, with or without payload.
     */
    msg: [T] extends [AbsentData] ? (message: string) => ActionLessMessage<AbsentData> : (message: string, data: T) => ActionLessMessage<T>;
    /**
     * Returns whether the given `IoMessage` instance matches the current message definition
     */
    is(x: IoMessage<unknown>): x is IoMessage<T>;
}
/**
 * A type that is impossible for a user to replicate
 * This is used to ensure that results always have a proper type generic declared.
 */
declare const privateKey: unique symbol;
export type ImpossibleType = {
    readonly [privateKey]: typeof privateKey;
};
type CodeInfoMaybeInterface<T> = [T] extends [AbsentData] ? Omit<CodeInfo, 'interface'> : Required<CodeInfo>;
/**
 * The type we use to represent an absent data field
 *
 * This is here to make it easy to change between `undefined`, `void`
 * and `never`.
 *
 * Not a lot of difference between `undefined` and `void`, but `void`
 * reads better.
 */
type AbsentData = void;
export declare const trace: <T = void>(details: CodeInfoMaybeInterface<T>) => IoMessageMaker<T>;
export declare const debug: <T = void>(details: CodeInfoMaybeInterface<T>) => IoMessageMaker<T>;
export declare const info: <T = void>(details: CodeInfoMaybeInterface<T>) => IoMessageMaker<T>;
export declare const warn: <T = void>(details: CodeInfoMaybeInterface<T>) => IoMessageMaker<T>;
export declare const error: <T = void>(details: CodeInfoMaybeInterface<T>) => IoMessageMaker<T>;
export declare const result: <T extends object = ImpossibleType>(details: Required<CodeInfo>) => IoMessageMaker<T>;
interface RequestInfo<U> extends CodeInfo {
    readonly defaultResponse: U;
}
/**
 * An interface that can produce requests for a specific code.
 */
export interface IoRequestMaker<T, U> extends MessageInfo {
    /**
     * Create a message for this code, with or without payload.
     */
    req: [T] extends [AbsentData] ? (message: string) => ActionLessMessage<AbsentData> : (message: string, data: T) => ActionLessRequest<T, U>;
}
/**
 * A request that is a simple yes/no question, with the expectation that 'yes' is the default.
 */
export declare const confirm: <T extends object = ImpossibleType>(details: Required<Omit<RequestInfo<boolean>, "defaultResponse">>) => IoRequestMaker<T, boolean>;
export {};
