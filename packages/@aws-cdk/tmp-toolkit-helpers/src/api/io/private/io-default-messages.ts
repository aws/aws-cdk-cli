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
  constructor(private readonly ioHelper: IoHelper) {
  }

  public notify(msg: ActionLessMessage<unknown>): Promise<void> {
    return this.ioHelper.notify(msg);
  }

  public requestResponse<T, U>(msg: ActionLessRequest<T, U>): Promise<U> {
    return this.ioHelper.requestResponse(msg);
  }

  public error(input: string, ...args: unknown[]) {
    this.emitMessage(IO.DEFAULT_TOOLKIT_ERROR, input, ...args);
  }

  public warn(input: string, ...args: unknown[]) {
    this.emitMessage(IO.DEFAULT_TOOLKIT_WARN, input, ...args);
  }

  public warning(input: string, ...args: unknown[]) {
    this.emitMessage(IO.DEFAULT_TOOLKIT_WARN, input, ...args);
  }

  public info(input: string, ...args: unknown[]) {
    this.emitMessage(IO.DEFAULT_TOOLKIT_INFO, input, ...args);
  }

  public debug(input: string, ...args: unknown[]) {
    this.emitMessage(IO.DEFAULT_TOOLKIT_DEBUG, input, ...args);
  }

  public trace(input: string, ...args: unknown[]) {
    this.emitMessage(IO.DEFAULT_TOOLKIT_TRACE, input, ...args);
  }

  public result(input: string, ...args: unknown[]) {
    const message = args.length > 0 ? util.format(input, ...args) : input;
    // This is just the default "info" message but with a level of "result"
    void this.ioHelper.notify({
      time: new Date(),
      code: IO.DEFAULT_TOOLKIT_INFO.code,
      level: 'result',
      message,
      data: undefined,
    });
  }

  private emitMessage(maker: IoMessageMaker<void>, input: string, ...args: unknown[]) {
    // Format message if args are provided
    const message = args.length > 0 ? util.format(input, ...args) : input;
    void this.ioHelper.notify(maker.msg(message));
  }
}
