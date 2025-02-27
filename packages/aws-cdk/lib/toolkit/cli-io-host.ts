import * as util from 'node:util';
import * as chalk from 'chalk';
import * as promptly from 'promptly';
import { ToolkitError } from './error';
import { RequireApproval } from '@aws-cdk/cloud-assembly-schema';
import { ActivityPrinterProps, CurrentActivityPrinter, HistoryActivityPrinter, IActivityPrinter } from '../cli/activity-printer';
import { StackActivityProgress } from '../commands/deploy';

export type IoMessageCodeCategory = 'TOOLKIT' | 'SDK' | 'ASSETS';
export type IoCodeLevel = 'E' | 'W' | 'I';
export type IoMessageSpecificCode<L extends IoCodeLevel> = `CDK_${IoMessageCodeCategory}_${L}${number}${number}${number}${number}`;
export type IoMessageCode = IoMessageSpecificCode<IoCodeLevel>;

/**
 * Basic message structure for toolkit notifications.
 * Messages are emitted by the toolkit and handled by the IoHost.
 */
export interface IoMessage<T> {
  /**
   * The time the message was emitted.
   */
  readonly time: Date;

  /**
   * The log level of the message.
   */
  readonly level: IoMessageLevel;

  /**
   * The action that triggered the message.
   */
  readonly action: ToolkitAction;

  /**
   * A short message code uniquely identifying a message type using the format CDK_[CATEGORY]_[E/W/I][000-999].
   *
   * The level indicator follows these rules:
   * - 'E' for error level messages
   * - 'W' for warning level messages
   * - 'I' for info/debug/trace level messages
   *
   * Codes ending in 000 are generic messages, while codes ending in 001-999 are specific to a particular message.
   * The following are examples of valid and invalid message codes:
   * ```ts
   * 'CDK_ASSETS_I000'       // valid: generic assets info message
   * 'CDK_TOOLKIT_E002'      // valid: specific toolkit error message
   * 'CDK_SDK_W023'          // valid: specific sdk warning message
   * ```
   */
  readonly code: IoMessageCode;

  /**
   * The message text.
   */
  readonly message: string;

  /**
   * The data attached to the message.
   */
  readonly data?: T;
}

export interface IoRequest<T, U> extends IoMessage<T> {
  /**
   * The default response that will be used if no data is returned.
   */
  readonly defaultResponse: U;

  /**
   * A level that governs when we request the response, and when we
   * can just take the default response.
   *
   * @default RequireApproval.BROADENING
   */
  readonly requireApproval?: RequireApproval;
}

export type IoMessageLevel = 'error' | 'result' | 'warn' | 'info' | 'debug' | 'trace';

export const levelPriority: Record<IoMessageLevel, number> = {
  error: 0,
  result: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/**
 * Temporary helper to group required props for IoMessages
 */
export interface IoMessaging {
  ioHost: IIoHost;
  action: ToolkitAction;
}

/**
 * The current action being performed by the CLI. 'none' represents the absence of an action.
 */
export type ToolkitAction =
| 'assembly'
| 'bootstrap'
| 'synth'
| 'list'
| 'diff'
| 'deploy'
| 'rollback'
| 'watch'
| 'destroy'
| 'context'
| 'docs'
| 'doctor'
| 'gc'
| 'import'
| 'metadata'
| 'notices'
| 'init'
| 'migrate'
| 'version';

export interface IIoHost {
  /**
   * Notifies the host of a message.
   * The caller waits until the notification completes.
   */
  notify<T>(msg: IoMessage<T>): Promise<void>;

  /**
   * Notifies the host of a message that requires a response.
   *
   * If the host does not return a response the suggested
   * default response from the input message will be used.
   */
  requestResponse<T, U>(msg: IoRequest<T, U>): Promise<U>;
}

export interface CliIoHostProps {
  /**
   * The initial Toolkit action the hosts starts with.
   *
   * @default 'none'
   */
  readonly currentAction?: ToolkitAction;

  /**
   * Determines the verbosity of the output.
   *
   * The CliIoHost will still receive all messages and requests,
   * but only the messages included in this level will be printed.
   *
   * @default 'info'
   */
  readonly logLevel?: IoMessageLevel;

  /**
   * Overrides the automatic TTY detection.
   *
   * When TTY is disabled, the CLI will have no interactions or color.
   *
   * @default - determined from the current process
   */
  readonly isTTY?: boolean;

  /**
   * Whether the CliIoHost is running in CI mode.
   *
   * In CI mode, all non-error output goes to stdout instead of stderr.
   * Set to false in the CliIoHost constructor it will be overwritten if the CLI CI argument is passed
   *
   * @default - determined from the environment, specifically based on `process.env.CI`
   */
  readonly isCI?: boolean;

  /**
   * In what scenarios should the CliIoHost ask for approval
   *
   * @default RequireApproval.BROADENING
   */
  readonly requireApproval?: RequireApproval;

  /*
   * The initial Toolkit action the hosts starts with.
   *
   * @default StackActivityProgress.BAR
   */
  readonly stackProgress?: StackActivityProgress;
}

/**
 * A simple IO host for the CLI that writes messages to the console.
 */
export class CliIoHost implements IIoHost {
  /**
   * Returns the singleton instance
   */
  static instance(props: CliIoHostProps = {}, forceNew = false): CliIoHost {
    if (forceNew || !CliIoHost._instance) {
      CliIoHost._instance = new CliIoHost(props);
    }
    return CliIoHost._instance;
  }

  /**
   * Singleton instance of the CliIoHost
   */
  private static _instance: CliIoHost | undefined;

  // internal state for getters/setter
  private _currentAction: ToolkitAction;
  private _isCI: boolean;
  private _isTTY: boolean;
  private _logLevel: IoMessageLevel;
  private _internalIoHost?: IIoHost;
  private _requireApproval: RequireApproval;
  private _progress: StackActivityProgress = StackActivityProgress.BAR;

  // Stack Activity Printer
  private activityPrinter?: IActivityPrinter;

  // Corked Logging
  private corkedCounter = 0;
  private readonly corkedLoggingBuffer: IoMessage<any>[] = [];

  private constructor(props: CliIoHostProps = {}) {
    this._currentAction = props.currentAction ?? 'none' as ToolkitAction;
    this._isTTY = props.isTTY ?? process.stdout.isTTY ?? false;
    this._logLevel = props.logLevel ?? 'info';
    this._isCI = props.isCI ?? isCI();
    this._requireApproval = props.requireApproval ?? RequireApproval.BROADENING;

    this.stackProgress = props.stackProgress ?? StackActivityProgress.BAR;
  }

  /**
   * Returns the singleton instance
   */
  public registerIoHost(ioHost: IIoHost) {
    if (ioHost !== this) {
      this._internalIoHost = ioHost;
    }
  }

  /**
   * Update the stackProgress preference.
   */
  public set stackProgress(type: StackActivityProgress) {
    this._progress = type;
  }

  /**
   * Gets the stackProgress value.
   *
   * This takes into account other state of the ioHost,
   * like if isTTY and isCI.
   */
  public get stackProgress(): StackActivityProgress {
    // We can always use EVENTS
    if (this._progress === StackActivityProgress.EVENTS) {
      return this._progress;
    }

    // if log level is tracing or debug, we default to the full history printer
    const verboseLogging = levelPriority[this.logLevel] > levelPriority.info;
    if (verboseLogging) {
      return StackActivityProgress.EVENTS;
    }

    // On Windows we cannot use fancy output
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      return StackActivityProgress.EVENTS;
    }

    // On some CI systems (such as CircleCI) output still reports as a TTY so we also
    // need an individual check for whether we're running on CI.
    // see: https://discuss.circleci.com/t/circleci-terminal-is-a-tty-but-term-is-not-set/9965
    const fancyOutputAvailable = this.isTTY && !this.isCI;
    if (!fancyOutputAvailable) {
      return StackActivityProgress.EVENTS;
    }

    // Use the user preference
    return this._progress;
  }

  /**
   * The current action being performed by the CLI.
   */
  public get currentAction(): ToolkitAction {
    return this._currentAction;
  }

  /**
   * Sets the current action being performed by the CLI.
   *
   * @param action The action being performed by the CLI.
   */
  public set currentAction(action: ToolkitAction) {
    this._currentAction = action;
  }

  /**
   * Whether the host can use interactions and message styling.
   */
  public get isTTY(): boolean {
    return this._isTTY;
  }

  /**
   * Set TTY mode, i.e can the host use interactions and message styling.
   *
   * @param value set TTY mode
   */
  public set isTTY(value: boolean) {
    this._isTTY = value;
  }

  /**
   * Return the conditions for requiring approval in this CliIoHost.
   */
  public get requireApproval() {
    return this._requireApproval;
  }

  /**
   * Set the conditions for requiring approval in this CliIoHost.
   */
  public set requireApproval(approval: RequireApproval) {
    this._requireApproval = approval;
  }

  /**
   * Whether the CliIoHost is running in CI mode. In CI mode, all non-error output goes to stdout instead of stderr.
   */
  public get isCI(): boolean {
    return this._isCI;
  }

  /**
   * Set the CI mode. In CI mode, all non-error output goes to stdout instead of stderr.
   * @param value set the CI mode
   */
  public set isCI(value: boolean) {
    this._isCI = value;
  }

  /**
   * The current threshold. Messages with a lower priority level will be ignored.
   */
  public get logLevel(): IoMessageLevel {
    return this._logLevel;
  }

  /**
   * Sets the current threshold. Messages with a lower priority level will be ignored.
   * @param level The new log level threshold
   */
  public set logLevel(level: IoMessageLevel) {
    this._logLevel = level;
  }

  /**
   * Executes a block of code with corked logging. All log messages during execution
   * are buffered and only written when all nested cork blocks complete (when CORK_COUNTER reaches 0).
   * The corking is bound to the specific instance of the CliIoHost.
   *
   * @param block - Async function to execute with corked logging
   * @returns Promise that resolves with the block's return value
   */
  public async withCorkedLogging<T>(block: () => Promise<T>): Promise<T> {
    this.corkedCounter++;
    try {
      return await block();
    } finally {
      this.corkedCounter--;
      if (this.corkedCounter === 0) {
        // Process each buffered message through notify
        for (const ioMessage of this.corkedLoggingBuffer) {
          await this.notify(ioMessage);
        }
        // remove all buffered messages in-place
        this.corkedLoggingBuffer.splice(0);
      }
    }
  }

  /**
   * Notifies the host of a message.
   * The caller waits until the notification completes.
   */
  public async notify<T>(msg: IoMessage<T>): Promise<void> {
    if (this._internalIoHost) {
      return this._internalIoHost.notify(msg);
    }

    if (this.isStackActivity(msg)) {
      if (!this.activityPrinter) {
        this.activityPrinter = this.makeActivityPrinter();
      }
      await this.activityPrinter.notify(msg);
      return;
    }

    if (levelPriority[msg.level] > levelPriority[this.logLevel]) {
      return;
    }

    if (this.corkedCounter > 0) {
      this.corkedLoggingBuffer.push(msg);
      return;
    }

    const output = this.formatMessage(msg);
    const stream = this.selectStream(msg.level);
    stream.write(output);
  }

  /**
   * Detect stack activity messages so they can be send to the printer.
   */
  private isStackActivity(msg: IoMessage<any>) {
    return [
      'CDK_TOOLKIT_I5501',
      'CDK_TOOLKIT_I5502',
      'CDK_TOOLKIT_I5503',
    ].includes(msg.code);
  }

  /**
   * Determines the output stream, based on message level and configuration.
   */
  private selectStream(level: IoMessageLevel) {
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
    // First call out to a registered instance if we have one
    if (this._internalIoHost) {
      return this._internalIoHost.requestResponse(msg);
    }

    // If the request cannot be prompted for by the CliIoHost, we just accept the default
    if (!isPromptableRequest(msg)) {
      await this.notify(msg);
      return msg.defaultResponse;
    }

    // If the request comes with a approval level and the IoHost is allowed to accept the default
    // we can skip prompting the user
    if (!this.shouldRequireApproval(msg.requireApproval)) {
      return msg.defaultResponse;
    }

    const response = await this.withCorkedLogging(async (): Promise<string | number | true> => {
      // prepare prompt data
      // @todo this format is not defined anywhere, probably should be
      const data: {
        motivation?: string;
        concurrency?: number;
      } = msg.data ?? {};

      const motivation = data.motivation ?? 'User input is needed';
      const concurrency = data.concurrency ?? 0;

      // only talk to user if STDIN is a terminal (otherwise, fail)
      if (!this.isTTY) {
        throw new ToolkitError(`${motivation}, but terminal (TTY) is not attached so we are unable to get a confirmation from the user`);
      }

      // only talk to user if concurrency is 1 (otherwise, fail)
      if (concurrency > 1) {
        throw new ToolkitError(`${motivation}, but concurrency is greater than 1 so we are unable to get a confirmation from the user`);
      }

      // Basic confirmation prompt
      // We treat all requests with a boolean response as confirmation prompts
      if (isConfirmationPrompt(msg)) {
        const confirmed = await promptly.confirm(`${chalk.cyan(msg.message)} (y/n)`);
        if (!confirmed) {
          throw new ToolkitError('Aborted by user');
        }
        return confirmed;
      }

      // Asking for a specific value
      const prompt = extractPromptInfo(msg);
      const answer = await promptly.prompt(`${chalk.cyan(msg.message)} (${prompt.default})`, {
        default: prompt.default,
      });
      return prompt.convertAnswer(answer);
    });

    // We need to cast this because it is impossible to narrow the generic type
    // isPromptableRequest ensures that the response type is one we can prompt for
    // the remaining code ensure we are indeed returning the correct type
    return response as ResponseType;
  }

  /**
   * Formats a message for console output with optional color support
   */
  private formatMessage(msg: IoMessage<any>): string {
    // apply provided style or a default style if we're in TTY mode
    let message_text = this._isTTY
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

  /**
   * Return true we need to request approval from the user.
   */
  private shouldRequireApproval(approval?: RequireApproval): boolean {
    // no given approval level means we don't need to request approval
    if (approval === undefined) {
      return false;
    }

    switch (this._requireApproval) {
      case RequireApproval.NEVER:
        // never request approval
        return false;
      case RequireApproval.BROADENING:
        return approval === RequireApproval.BROADENING;
      case RequireApproval.ANYCHANGE:
        // request approval for BROADENING and ANYCHANGE
        return approval !== RequireApproval.NEVER;
    }
  }

  /*
   * Get an instance of the ActivityPrinter
   */
  private makeActivityPrinter() {
    const props: ActivityPrinterProps = {
      stream: this.selectStream('info'),
    };

    switch (this.stackProgress) {
      case StackActivityProgress.EVENTS:
        return new HistoryActivityPrinter(props);
      case StackActivityProgress.BAR:
        return new CurrentActivityPrinter(props);
    }
  }
}

/**
 * This IoHost implementation considers a request promptable, if:
 * - it's a yes/no confirmation
 * - asking for a string or number value
 */
function isPromptableRequest(msg: IoRequest<any, any>): msg is IoRequest<any, string | number | boolean> {
  return isConfirmationPrompt(msg)
    || typeof msg.defaultResponse === 'string'
    || typeof msg.defaultResponse === 'number';
}

/**
 * Check if the request is a confirmation prompt
 * We treat all requests with a boolean response as confirmation prompts
 */
function isConfirmationPrompt(msg: IoRequest<any, any>): msg is IoRequest<any, boolean> {
  return typeof msg.defaultResponse === 'boolean';
}

/**
 * Helper to extract information for promptly from the request
 */
function extractPromptInfo(msg: IoRequest<any, any>): {
  default: string;
  convertAnswer: (input: string) => string | number;
} {
  const isNumber = (typeof msg.defaultResponse === 'number');
  return {
    default: util.format(msg.defaultResponse),
    convertAnswer: isNumber ? (v) => Number(v) : (v) => String(v),
  };
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
 * Returns true if the current process is running in a CI environment
 * @returns true if the current process is running in a CI environment
 */
export function isCI(): boolean {
  return process.env.CI !== undefined && process.env.CI !== 'false' && process.env.CI !== '0';
}

