import * as util from 'util';
import type { ActionLessMessage, IoHelper } from './io-helper';
import type { IoMessageLevel } from '../io-message';

/**
 * Helper class to emit standard log messages to an IoHost
 *
 * It wraps an `IoHelper`, and adds convenience methods to emit default messages
 * for the various log levels.
 */
export class IoDefaultMessages {
  private readonly ioHelper: IoHelper;

  constructor(ioHelper: IoHelper) {
    this.ioHelper = ioHelper;
  }

  public async notify(msg: Omit<ActionLessMessage<unknown>, 'code'>): Promise<void> {
    return this.ioHelper.notify({
      ...msg,
      code: undefined,
    });
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
      level,
      message,
      data: undefined,
    };
  }

  private async emitMessage(level: IoMessageLevel, input: string, ...args: unknown[]): Promise<void> {
    return this.ioHelper.notify(this.msg(level, input, ...args));
  }
}
