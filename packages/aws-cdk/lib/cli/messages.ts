// This file is a backport from @aws-cdk/toolkit.
// The CLI cannot depend on the toolkit yet, because the toolkit currently depends on the CLI.
// Once we have complete the repo split, we will create a temporary, private library package
// for all code that is shared between CLI and toolkit. This is where this file will then live.
import type { IoMessageCode, IoMessageLevel } from './io-host';
import type { ActionLessMessage } from '../../../@aws-cdk/toolkit-lib/lib/api/io/private';
import type { IoMessageCodeCategory } from '../logging';

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
type SimplifiedMessage<T> = Omit<ActionLessMessage<T>, 'time'>;

/**
 * Internal helper that processes log inputs into a consistent format.
 * Handles string interpolation, format strings, and object parameter styles.
 * Applies optional styling and prepares the final message for logging.
 */
export function formatMessage<T>(msg: Optional<SimplifiedMessage<T>, 'code'>, category: IoMessageCodeCategory = 'TOOLKIT'): ActionLessMessage<T> {
  return {
    time: new Date(),
    level: msg.level,
    code: msg.code ?? defaultMessageCode(msg.level, category),
    message: msg.message,
    data: msg.data,
  };
}

/**
 * Build a message code from level and category. The code must be valid for this function to pass.
 * Otherwise it returns a ToolkitError.
 */
function defaultMessageCode(level: IoMessageLevel, category: IoMessageCodeCategory = 'TOOLKIT'): IoMessageCode {
  const levelIndicator = level === 'error' ? 'E' :
    level === 'warn' ? 'W' :
      'I';
  return `CDK_${category}_${levelIndicator}0000`;
}

/**
 * Creates an error level message.
 * Errors must always have a unique code.
 */
export const error = <T>(message: string, code: IoMessageCode, payload?: T) => {
  return formatMessage({
    level: 'error',
    code,
    message,
    data: payload,
  });
};

/**
 * Creates a result level message and represents the most important message for a given action.
 *
 * They should be used sparsely, with an action usually having no or exactly one result.
 * However actions that operate on Cloud Assemblies might include a result per Stack.
 * Unlike other messages, results must always have a code and a payload.
 */
export const result = <T>(message: string, code: IoMessageCode, payload: T) => {
  return formatMessage({
    level: 'result',
    code,
    message,
    data: payload,
  });
};

/**
 * Creates a warning level message.
 */
export const warn = <T>(message: string, code?: IoMessageCode, payload?: T) => {
  return formatMessage({
    level: 'warn',
    code,
    message,
    data: payload,
  });
};

/**
 * Creates an info level message.
 */
export const info = <T>(message: string, code?: IoMessageCode, payload?: T) => {
  return formatMessage({
    level: 'info',
    code,
    message,
    data: payload,
  });
};

/**
 * Creates a debug level message.
 */
export const debug = <T>(message: string, code?: IoMessageCode, payload?: T) => {
  return formatMessage({
    level: 'debug',
    code,
    message,
    data: payload,
  });
};

/**
 * Creates a trace level message.
 */
export const trace = <T>(message: string, code?: IoMessageCode, payload?: T) => {
  return formatMessage({
    level: 'trace',
    code,
    message,
    data: payload,
  });
};

