import * as util from 'util';
import type { ActionLessMessage, ActionLessRequest, IoHelper } from './io-helper';
import type { IoMessageCode, IoMessageLevel } from '../io-message';

/**
 * Helper class to emit standard log messages to an IoHost
 *
 * It wraps an `IoHelper`, and adds convenience methods to emit default messages
 * for the various log levels.
 */
export class IoDefaultMessages {
  private readonly ioHelper: IoHelper;
  private readonly category: 'TOOLKIT' | 'ASSEMBLY' | 'SDK';

  constructor(ioHelper: IoHelper, category: 'TOOLKIT' | 'ASSEMBLY' | 'SDK') {
    this.ioHelper = ioHelper;
    this.category = category;
  }

  public async notify(msg: Omit<ActionLessMessage<unknown>, 'code'>): Promise<void> {
    return this.ioHelper.notify({
      ...msg,
      code: levelToCode(this.category, msg.level),
    });
  }

  public async requestResponse<T, U>(msg: ActionLessRequest<T, U>): Promise<U> {
    return this.ioHelper.requestResponse(msg);
  }

  public async error(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage('error', input, ...args);
  }

  public async warn(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage('warn', input, ...args);
  }

  public async warning(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage('warn', input, ...args);
  }

  public async info(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage('info', input, ...args);
  }

  public async debug(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage('debug', input, ...args);
  }

  public async trace(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage('trace', input, ...args);
  }

  public async result(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage('result', input, ...args);
  }

  /**
   * Makes a default message object from a level and a message
   */
  public msg(level: IoMessageLevel, input: string, ...args: unknown[]): ActionLessMessage<undefined> {
    // Format message if args are provided
    const message = args.length > 0 ? util.format(input, ...args) : input;

    return {
      time: new Date(),
      code: levelToCode(this.category, level),
      level,
      message,
      data: undefined,
    };
  }

  private async emitMessage(level: IoMessageLevel, input: string, ...args: unknown[]): Promise<void> {
    return this.ioHelper.notify(this.msg(level, input, ...args));
  }
}

function levelToCode(category: string, level: IoMessageLevel): IoMessageCode {
  switch (level) {
    case 'error':
      return `CDK_${category}_E0000`;
    case 'warn':
      return `CDK_${category}_W0000`;
    default:
      return `CDK_${category}_I0000`;
  }
}
