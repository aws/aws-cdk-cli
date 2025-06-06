import * as chalk from 'chalk';
import type { IIoHost, IoMessage, IoMessageLevel, IoRequest } from '../api/io';
import { isMessageRelevantForLevel } from '../api/io/private';
import { HistoryActivityPrinter, type IActivityPrinter } from '../private/activity-printer';
import { isCI, isTTY } from '../util/shell-env';

export interface NonInteractiveIoHostProps {
  /**
   * Determines the verbosity of the output.
   *
   * The IoHost will still receive all messages and requests,
   * but only the messages included in this level will be printed.
   *
   * @defaultValue 'info'
   */
  readonly logLevel?: IoMessageLevel;

  /**
   * Overrides the automatic TTY detection.
   *
   * When TTY is disabled, the CLI will have no interactions or color.
   *
   * @defaultValue - determined from the current process
   */
  readonly isTTY?: boolean;

  /**
   * Whether the IoHost is running in CI mode.
   *
   * In CI mode, all non-error output goes to stdout instead of stderr.
   * Set to false in the IoHost constructor it will be overwritten if the CLI CI argument is passed
   *
   * @defaultValue - determined from the environment, specifically based on `process.env.CI`
   */
  readonly isCI?: boolean;
}

/**
 * A simple IO host for a non interactive CLI that writes messages to the console and returns the default answer to all requests.
 */
export class NonInteractiveIoHost implements IIoHost {
  /**
   * Whether the IoHost is running in CI mode.
   *
   * In CI mode, all non-error output goes to stdout instead of stderr.
   */
  public readonly isCI: boolean;

  /**
   * Whether the host can use interactions and message styling.
   */
  public readonly isTTY: boolean;

  /**
   * The current threshold.
   *
   * Messages with a lower priority level will be ignored.
   */
  public readonly logLevel: IoMessageLevel;

  // Stack Activity Printer
  private readonly activityPrinter: IActivityPrinter;

  public constructor(props: NonInteractiveIoHostProps = {}) {
    this.logLevel = props.logLevel ?? 'info';
    this.isTTY = props.isTTY ?? isTTY();
    this.isCI = props.isCI ?? isCI();

    this.activityPrinter = new HistoryActivityPrinter({
      stream: this.selectStreamFromLevel('info'),
    });
  }

  /**
   * Notifies the host of a message.
   * The caller waits until the notification completes.
   */
  public async notify(msg: IoMessage<unknown>): Promise<void> {
    if (isStackActivity(msg)) {
      return this.activityPrinter.notify(msg);
    }

    if (!isMessageRelevantForLevel(msg, this.logLevel)) {
      return;
    }

    const output = this.formatMessage(msg);
    const stream = this.selectStream(msg);
    stream?.write(output);
  }

  /**
   * Determines the output stream, based on message and configuration.
   */
  private selectStream(msg: IoMessage<any>): NodeJS.WriteStream | undefined {
    return this.selectStreamFromLevel(msg.level);
  }

  /**
   * Determines the output stream, based on message level and configuration.
   */
  private selectStreamFromLevel(level: IoMessageLevel): NodeJS.WriteStream {
    // The stream selection policy for the CLI is the following:
    //
    //   (1) Messages of level `result` always go to `stdout`
    //   (2) Messages of level `error` always go to `stderr`.
    //   (3a) All remaining messages go to `stderr`.
    //   (3b) If we are in CI mode, all remaining messages go to `stdout`.
    //
    switch (level) {
      case 'error':
        return process.stderr;
      case 'result':
        return process.stdout;
      default:
        return this.isCI ? process.stdout : process.stderr;
    }
  }

  /**
   * Notifies the host of a message that requires a response.
   *
   * If the host does not return a response the suggested
   * default response from the input message will be used.
   */
  public async requestResponse<DataType, ResponseType>(msg: IoRequest<DataType, ResponseType>): Promise<ResponseType> {
    // in the non-interactive IoHost, no requests are promptable
    await this.notify(msg);
    return msg.defaultResponse;
  }

  /**
   * Formats a message for console output with optional color support
   */
  private formatMessage(msg: IoMessage<unknown>): string {
    // apply provided style or a default style if we're in TTY mode
    let message_text = this.isTTY
      ? styleMap[msg.level](msg.message)
      : msg.message;

    // prepend timestamp if IoMessageLevel is DEBUG or TRACE. Postpend a newline.
    return ((msg.level === 'debug' || msg.level === 'trace')
      ? `[${this.formatTime(msg.time)}] ${message_text}`
      : message_text) + '\n';
  }

  /**
   * Formats date to HH:MM:SS
   */
  private formatTime(d: Date): string {
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

const styleMap: Record<IoMessageLevel, (str: string) => string> = {
  error: chalk.red,
  warn: chalk.yellow,
  result: chalk.white,
  info: chalk.white,
  debug: chalk.gray,
  trace: chalk.gray,
};

/**
 * Detect stack activity messages so they can be send to the printer.
 */
function isStackActivity(msg: IoMessage<unknown>) {
  return msg.code && [
    'CDK_TOOLKIT_I5501',
    'CDK_TOOLKIT_I5502',
    'CDK_TOOLKIT_I5503',
  ].includes(msg.code);
}
