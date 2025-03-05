import { IoMessageCode, IoMessageLevel } from '../io-message';
import { ActionLessMessage } from './action-aware';

/**
 * Information for each IO Message Code.
 */
interface CodeInfo {
  /**
   * The message code.
   */
  code: IoMessageCode;

  /**
   * A brief description of the meaning of this IO Message.
   */
  description: string;

  /**
   * The name of the payload interface, if applicable.
   * Some Io Messages include a payload, with a specific interface. The name of
   * the interface is specified here so that it can be linked with the message
   * when documentation is generated.
   *
   * The interface _must_ be exposed directly from toolkit-lib, so that it will
   * have a documentation page generated (that can be linked to).
   */
  interface?: string;
}

/**
 * Information for each IO Message
 */
interface MessageInfo extends CodeInfo {
  /**
   * The message level
   */
  level: IoMessageLevel;
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
function generic<T = never>(level: IoMessageLevel, details: CodeInfo): IoMessageMaker<T> {
  const msg = (message: string, data: T) => ({
    time: new Date(),
    level,
    code: details.code,
    message: message,
    data: data,
  } as ActionLessMessage<T>);

  return {
    ...details,
    level,
    msg: msg as any,
  };
}

// Create `IoMessageMaker`s for a given level and type check that calls with payload are using the correct interface
type CodeInfoMaybeInterface<T> = [T] extends [never] ? Omit<CodeInfo, 'interface'> : Required<CodeInfo>;

export const trace = <T = never>(details: CodeInfoMaybeInterface<T>) => generic<T>('trace', details);
export const debug = <T = never>(details: CodeInfoMaybeInterface<T>) => generic<T>('debug', details);
export const info = <T = never>(details: CodeInfoMaybeInterface<T>) => generic<T>('info', details);
export const warn = <T = never>(details: CodeInfoMaybeInterface<T>) => generic<T>('warn', details);
export const error = <T = never>(details: CodeInfoMaybeInterface<T>) => generic<T>('error', details);
export const result = <T extends object>(details: Required<CodeInfo>) => generic<T extends object ? T : never>('result', details);
