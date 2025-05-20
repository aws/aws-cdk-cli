import * as util from 'util';
import type { ActionLessMessage, ActionLessRequest, IoHelper } from './io-helper';
import type { IoMessageMaker } from './message-maker';
import { IO } from './messages';

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

  public async notify(msg: ActionLessMessage<unknown>): Promise<void> {
    return this.ioHelper.notify(msg);
  }

  public async requestResponse<T, U>(msg: ActionLessRequest<T, U>): Promise<U> {
    return this.ioHelper.requestResponse(msg);
  }

  public async error(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage(IO.DEFAULT_TOOLKIT_ERROR, input, ...args);
  }

  public async warn(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage(IO.DEFAULT_TOOLKIT_WARN, input, ...args);
  }

  public async warning(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage(IO.DEFAULT_TOOLKIT_WARN, input, ...args);
  }

  public async info(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage(IO.DEFAULT_TOOLKIT_INFO, input, ...args);
  }

  public async debug(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage(IO.DEFAULT_TOOLKIT_DEBUG, input, ...args);
  }

  public async trace(input: string, ...args: unknown[]): Promise<void> {
    return this.emitMessage(IO.DEFAULT_TOOLKIT_TRACE, input, ...args);
  }

  public async result(input: string, ...args: unknown[]): Promise<void> {
    const message = args.length > 0 ? util.format(input, ...args) : input;
    // This is just the default "info" message but with a level of "result"
    return this.ioHelper.notify({
      time: new Date(),
      code: IO.DEFAULT_TOOLKIT_INFO.code,
      level: 'result',
      message,
      data: undefined,
    });
  }

  private async emitMessage(maker: IoMessageMaker<void>, input: string, ...args: unknown[]): Promise<void> {
    // Format message if args are provided
    const message = args.length > 0 ? util.format(input, ...args) : input;
    return this.ioHelper.notify(maker.msg(message));
  }
}
