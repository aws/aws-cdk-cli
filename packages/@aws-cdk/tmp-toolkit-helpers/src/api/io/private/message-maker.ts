import { IoMessageCode, IoMessageLevel } from '../io-message';
import { ActionLessMessage, ActionLessRequest } from './action-aware';

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
  msg: [T] extends [never] ? (message: string) => ActionLessMessage<never> : (message: string, data: T) => ActionLessMessage<T>;
}

/**
 * Produce an IoMessageMaker for the provided level and code info.
 */
function message<T = never>(level: IoMessageLevel, details: CodeInfo): IoMessageMaker<T> {
  const maker = (text: string, data: T) => ({
    time: new Date(),
    level,
    code: details.code,
    message: text,
    data,
  } as ActionLessMessage<T>);

  return {
    ...details,
    level,
    msg: maker as any,
  };
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
type CodeInfoMaybeInterface<T> = [T] extends [never] ? Omit<CodeInfo, 'interface'> : Required<CodeInfo>;

export const trace = <T = never>(details: CodeInfoMaybeInterface<T>) => message<T>('trace', details);
export const debug = <T = never>(details: CodeInfoMaybeInterface<T>) => message<T>('debug', details);
export const info = <T = never>(details: CodeInfoMaybeInterface<T>) => message<T>('info', details);
export const warn = <T = never>(details: CodeInfoMaybeInterface<T>) => message<T>('warn', details);
export const error = <T = never>(details: CodeInfoMaybeInterface<T>) => message<T>('error', details);
export const result = <T extends object = ImpossibleType>(details: Required<CodeInfo>) => message<T extends object ? T : never>('result', details);

interface RequestInfo<U> extends CodeInfo {
  readonly defaultResponse: U;
}

/**
 * An interface that can produce messages for a specific code.
 */
export interface IoRequestMaker<T, U> extends MessageInfo {
  /**
   * Create a message for this code, with or without payload.
   */
  req: [T] extends [never] ? (message: string) => ActionLessMessage<never> : (message: string, data: T) => ActionLessRequest<T, U>;
}

/**
 * Produce an IoMessageMaker for the provided level and code info.
 */
function request<T = never, U = ImpossibleType>(level: IoMessageLevel, details: RequestInfo<U>): IoRequestMaker<T, U> {
  const maker = (text: string, data: T) => ({
    time: new Date(),
    level,
    code: details.code,
    message: text,
    data,
    defaultResponse: details.defaultResponse,
  } as ActionLessRequest<T, U>);

  return {
    ...details,
    level,
    req: maker as any,
  };
}

/**
 * A request that is a simple yes/no question, with the expectation that 'yes' is the default.
 */
export const confirm = <T extends object = ImpossibleType>(details: Required<Omit<RequestInfo<boolean>, 'defaultResponse'>>) => request<T, boolean>('info', {
  ...details,
  defaultResponse: true,
});
