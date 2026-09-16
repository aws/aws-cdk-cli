import type { IoMessage, IoRequest, IoMessageCode, IoMessageLevel } from '../io-message';
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
 *
 * The maker is itself a type guard over `IoMessage`, so it can be handed
 * directly to anything that selects messages, as in `host.on(IO.MY_CODE, fn)`,
 * and the listener receives a typed payload.
 */
export interface IoMessageMaker<T> extends MessageInfo {
  /**
   * Returns whether the given `IoMessage` instance matches this message definition.
   */
  (x: IoMessage<unknown>): x is IoMessage<T>;

  /**
   * Create a message for this code, with or without payload.
   */
  msg: [T] extends [AbsentData] ? (message: string) => ActionLessMessage<AbsentData> : (message: string, data: T) => ActionLessMessage<T>;
}

/**
 * Produce an IoMessageMaker for the provided level and code info.
 */
function message<T = AbsentData>(level: IoMessageLevel, details: CodeInfo): IoMessageMaker<T> {
  const maker = (text: string, data: T) => ({
    time: new Date(),
    level,
    code: details.code,
    message: text,
    data,
  } as ActionLessMessage<T>);

  const matches = (m: IoMessage<unknown>): m is IoMessage<T> => m.code === details.code;

  return Object.assign(matches, {
    ...details,
    level,
    msg: maker as any,
  });
}

/**
 * A type that is impossible for a user to replicate
 * This is used to ensure that results always have a proper type generic declared.
 */
declare const privateKey: unique symbol;
export type ImpossibleType = {
  readonly [privateKey]: typeof privateKey;
};

// Create `IoMessageMaker`s for a given level and type check that calls with payload are using the correct interface
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

export const trace = <T = AbsentData>(details: CodeInfoMaybeInterface<T>) => message<T>('trace', details);
export const debug = <T = AbsentData>(details: CodeInfoMaybeInterface<T>) => message<T>('debug', details);
export const info = <T = AbsentData>(details: CodeInfoMaybeInterface<T>) => message<T>('info', details);
export const warn = <T = AbsentData>(details: CodeInfoMaybeInterface<T>) => message<T>('warn', details);
export const error = <T = AbsentData>(details: CodeInfoMaybeInterface<T>) => message<T>('error', details);
export const result = <T extends object = ImpossibleType>(details: Required<CodeInfo>) => message<T>('result', details);

interface RequestInfo<U> extends CodeInfo {
  readonly defaultResponse: U;
}

/**
 * An interface that can produce requests for a specific code.
 *
 * Like `IoMessageMaker`, the maker is itself a type guard, and it narrows all
 * the way to `IoRequest`, so `host.respond(IO.MY_CODE, value)` checks `value`
 * against this request's response type.
 */
export interface IoRequestMaker<T, U> extends MessageInfo {
  /**
   * Returns whether the given `IoMessage` instance matches this request definition.
   */
  (x: IoMessage<unknown>): x is IoRequest<T, U>;

  /**
   * Create a message for this code, with or without payload.
   */
  req: [T] extends [AbsentData]
    ? (message: string) => ActionLessMessage<AbsentData>
    : [U] extends [boolean]
      ? (message: string, data: T) => ActionLessRequest<T, U>
      : (message: string, data: T, defaultResponse: U) => ActionLessRequest<T, U>;
}

/**
 * Produce an IoRequestMaker for the provided level and request info.
 */
function request<T = AbsentData, U = ImpossibleType>(level: IoMessageLevel, details: RequestInfo<U>): IoRequestMaker<T, U> {
  const maker = (text: string, data: T) => ({
    time: new Date(),
    level,
    code: details.code,
    message: text,
    data,
    defaultResponse: details.defaultResponse,
  } as ActionLessRequest<T, U>);

  const matches = (m: IoMessage<unknown>): m is IoRequest<T, U> => m.code === details.code;

  return Object.assign(matches, {
    ...details,
    level,
    req: maker as any,
  });
}

/**
 * A request that is a simple yes/no question, with the expectation that 'yes' is the default.
 */
export const confirm = <T extends object = ImpossibleType>(details: Required<Omit<RequestInfo<boolean>, 'defaultResponse'>>) => request<T, boolean>('info', {
  ...details,
  defaultResponse: true,
});

/**
 * An open ended question with a string answer, typically provided on-demand by a user.
 */
export function question<T>(details: CodeInfo): IoRequestMaker<T, string> {
  const level: IoMessageLevel = 'info';
  const maker = (text: string, data: T, defaultResponse: string) => ({
    time: new Date(),
    level,
    code: details.code,
    message: text,
    data,
    defaultResponse,
  } as ActionLessRequest<T, string>);

  const matches = (m: IoMessage<unknown>): m is IoRequest<T, string> => m.code === details.code;

  return Object.assign(matches, {
    ...details,
    level,
    req: maker as any,
  });
}
