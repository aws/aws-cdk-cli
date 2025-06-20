import * as util from 'node:util';
import { RequireApproval } from '@aws-cdk/cloud-assembly-schema';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import type { IIoHost, IoMessage, IoMessageCode, IoMessageLevel, IoRequest, ToolkitAction } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import * as promptly from 'promptly';
import type { IoHelper, ActivityPrinterProps, IActivityPrinter } from '../../../lib/api-private';
import { asIoHelper, IO, isMessageRelevantForLevel, CurrentActivityPrinter, HistoryActivityPrinter } from '../../../lib/api-private';
import { StackActivityProgress } from '../../commands/deploy';
import type { ITelemetryClient } from '../telemetry/client-interface';
import type { SessionSchema } from '../telemetry/schema';
import { randomUUID } from 'node:crypto';
import * as version from './../version';
import { IoHostTelemetryClient } from '../telemetry/io-host-client';
import { getInstallationId } from '../telemetry/installation-id';
import { makeConfig } from '../cli-config';
import { sanitizeCommandLineArguments, sanitizeContext } from '../telemetry/sanitation-utils';
import { AccountIdFetcher } from '../telemetry/account-id-fetcher';
import { RegionFetcher } from '../telemetry/region-fetcher';

export type { IIoHost, IoMessage, IoMessageCode, IoMessageLevel, IoRequest };

/**
 * The current action being performed by the CLI. 'none' represents the absence of an action.
 */
type CliAction =
| ToolkitAction
| 'context'
| 'docs'
| 'notices'
| 'version'
| 'none';

export interface CliIoHostProps {
  /**
   * The initial Toolkit action the hosts starts with.
   *
   * @default 'none'
   */
  readonly currentAction?: CliAction;

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
  readonly requireDeployApproval?: RequireApproval;

  /**
   * The initial Toolkit action the hosts starts with.
   *
   * @default StackActivityProgress.BAR
   */
  readonly stackProgress?: StackActivityProgress;
}

/**
 * A type for configuring a target stream
 */
export type TargetStream = 'stdout' | 'stderr' | 'drop';

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

  /**
   * The current action being performed by the CLI.
   */
  public currentAction: CliAction;

  /**
   * Whether the CliIoHost is running in CI mode.
   *
   * In CI mode, all non-error output goes to stdout instead of stderr.
   */
  public isCI: boolean;

  /**
   * Whether the host can use interactions and message styling.
   */
  public isTTY: boolean;

  /**
   * The current threshold.
   *
   * Messages with a lower priority level will be ignored.
   */
  public logLevel: IoMessageLevel;

  /**
   * The conditions for requiring approval in this CliIoHost.
   */
  public requireDeployApproval: RequireApproval;

  /**
   * Configure the target stream for notices
   *
   * (Not a setter because there's no need for additional logic when this value
   * is changed yet)
   */
  public noticesDestination: TargetStream = 'stderr';

  private _internalIoHost?: IIoHost;
  private _progress: StackActivityProgress = StackActivityProgress.BAR;

  // Stack Activity Printer
  private activityPrinter?: IActivityPrinter;

  // Corked Logging
  private corkedCounter = 0;
  private readonly corkedLoggingBuffer: IoMessage<unknown>[] = [];

  private telemetryClient?: ITelemetryClient;
  private telemetryInfo?: SessionSchema;
  private telemetryCount = 0;

  private constructor(props: CliIoHostProps = {}) {
    this.currentAction = props.currentAction ?? 'none';
    this.isTTY = props.isTTY ?? process.stdout.isTTY ?? false;
    this.logLevel = props.logLevel ?? 'info';
    this.isCI = props.isCI ?? isCI();
    this.requireDeployApproval = props.requireDeployApproval ?? RequireApproval.BROADENING;

    this.stackProgress = props.stackProgress ?? StackActivityProgress.BAR;
  }

  /**
   * Required for telemetry
   */
  public async bindTelemetryClient(argv: any, context: {[key: string]: any}) {
    // TODO: change this to EndpointTelemetryClient
    this.telemetryClient = new IoHostTelemetryClient({
      ioHost: this,
    });

    // sanitize the raw cli input
    const command = sanitizeCommandLineArguments(argv, await makeConfig());
    this.telemetryInfo = {
      identifiers: {
        installationId: getInstallationId(this.asIoHelper()),
        sessionId: randomUUID(),
        telemetryVersion: '1.0',
        cdkCliVersion: version.versionNumber(),
        accountId: await new AccountIdFetcher().fetch(),
        region: await new RegionFetcher().fetch(),
      },
      event: {
        command: {
          path: command.path,
          parameters: command.parameters,
          config: sanitizeContext(context),
        },
      },
      environment: {
        ci: Boolean(process.env.CI),
        os: {
          platform: process.platform,
          release: process.release.name,
        },
        nodeVersion: process.version,
      },
      project: {},
    };
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

    // if a debug message (and thus any more verbose messages) are relevant to the current log level, we have verbose logging
    const verboseLogging = isMessageRelevantForLevel({ level: 'debug' }, this.logLevel);
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

  public get defaults() {
    return this.asIoHelper().defaults;
  }

  public asIoHelper(): IoHelper {
    return asIoHelper(this, this.currentAction as any);
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
  public async notify(msg: IoMessage<unknown>): Promise<void> {
    if (this._internalIoHost) {
      return this._internalIoHost.notify(msg);
    }

    if (process.env.TELEMETRY_TEST_ENV) {
      try {
        if (this.isTelemetryMessage(msg)) {
          await this.emitTelemetry(msg);
          return; // This eats the message for now
        }
      } catch (e: any) {
        this.defaults.debug(`Emit Telemetry Failed ${e.message}`);
      }
    }

    if (this.isStackActivity(msg)) {
      if (!this.activityPrinter) {
        this.activityPrinter = this.makeActivityPrinter();
      }
      await this.activityPrinter.notify(msg);
      return;
    }

    if (!isMessageRelevantForLevel(msg, this.logLevel)) {
      return;
    }

    if (this.corkedCounter > 0) {
      this.corkedLoggingBuffer.push(msg);
      return;
    }

    const output = this.formatMessage(msg);
    const stream = this.selectStream(msg);
    stream?.write(output);
  }

  private isTelemetryMessage(msg: IoMessage<any>) {
    return msg.data && msg.data.telemetry;
  }

  private async emitTelemetry(msg: IoMessage<any>) {
    // Session has not been attached
    if (!this.telemetryInfo) { 
      throw new ToolkitError('Session must be attached before telemetry is emitted');
    }

    const event = msg.data.telemetry;
    await this.telemetryClient?.emit({
      event: {
        command: this.telemetryInfo.event.command,
        state: event.state,
        eventType: event.eventType,
      },
      identifiers: {
        ...this.telemetryInfo.identifiers,
        eventId: `${this.telemetryInfo.identifiers.sessionId}:${this.telemetryCount}`,
        timestamp: new Date().toISOString(),
      },
      environment: this.telemetryInfo.environment,
      project: this.telemetryInfo.project,
      duration: {
        total: event.duration,
      },
      ...(event.error ? {
        error: {
          name: event.error.name,
        },
      } : {}),
    });
    this.telemetryCount+=1;
  }

  /**
   * Detect stack activity messages so they can be send to the printer.
   */
  private isStackActivity(msg: IoMessage<unknown>) {
    return msg.code && [
      'CDK_TOOLKIT_I5501',
      'CDK_TOOLKIT_I5502',
      'CDK_TOOLKIT_I5503',
    ].includes(msg.code);
  }

  /**
   * Detect special messages encode information about whether or not
   * they require approval
   */
  private skipApprovalStep(msg: IoRequest<any, any>): boolean {
    const approvalToolkitCodes = ['CDK_TOOLKIT_I5060'];
    if (!(msg.code && approvalToolkitCodes.includes(msg.code))) {
      false;
    }

    switch (this.requireDeployApproval) {
      // Never require approval
      case RequireApproval.NEVER:
        return true;
      // Always require approval
      case RequireApproval.ANYCHANGE:
        return false;
      // Require approval if changes include broadening permissions
      case RequireApproval.BROADENING:
        return ['none', 'non-broadening'].includes(msg.data?.permissionChangeType);
    }
  }

  /**
   * Determines the output stream, based on message and configuration.
   */
  private selectStream(msg: IoMessage<any>): NodeJS.WriteStream | undefined {
    if (isNoticesMessage(msg)) {
      return targetStreamObject(this.noticesDestination);
    }

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
    // First call out to a registered instance if we have one
    if (this._internalIoHost) {
      return this._internalIoHost.requestResponse(msg);
    }

    // If the request cannot be prompted for by the CliIoHost, we just accept the default
    if (!isPromptableRequest(msg)) {
      await this.notify(msg);
      return msg.defaultResponse;
    }

    const response = await this.withCorkedLogging(async (): Promise<string | number | true> => {
      // prepare prompt data
      // @todo this format is not defined anywhere, probably should be
      const data: {
        motivation?: string;
        concurrency?: number;
        responseDescription?: string;
      } = msg.data ?? {};

      const motivation = data.motivation ?? 'User input is needed';
      const concurrency = data.concurrency ?? 0;
      const responseDescription = data.responseDescription;

      // only talk to user if STDIN is a terminal (otherwise, fail)
      if (!this.isTTY) {
        throw new ToolkitError(`${motivation}, but terminal (TTY) is not attached so we are unable to get a confirmation from the user`);
      }

      // only talk to user if concurrency is 1 (otherwise, fail)
      if (concurrency > 1) {
        throw new ToolkitError(`${motivation}, but concurrency is greater than 1 so we are unable to get a confirmation from the user`);
      }

      // Special approval prompt
      // Determine if the message needs approval. If it does, continue (it is a basic confirmation prompt)
      // If it does not, return success (true). We only check messages with codes that we are aware
      // are requires approval codes.
      if (this.skipApprovalStep(msg)) {
        return true;
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
      const desc = responseDescription ?? prompt.default;
      const answer = await promptly.prompt(`${chalk.cyan(msg.message)}${desc ? ` (${desc})` : ''}`, {
        default: prompt.default,
        trim: true,
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

  /**
   * Get an instance of the ActivityPrinter
   */
  private makeActivityPrinter() {
    const props: ActivityPrinterProps = {
      stream: this.selectStreamFromLevel('info'),
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
  defaultDesc: string;
  convertAnswer: (input: string) => string | number;
} {
  const isNumber = (typeof msg.defaultResponse === 'number');
  const defaultResponse = util.format(msg.defaultResponse);
  return {
    default: defaultResponse,
    defaultDesc: 'defaultDescription' in msg && msg.defaultDescription ? util.format(msg.defaultDescription) : defaultResponse,
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

function targetStreamObject(x: TargetStream): NodeJS.WriteStream | undefined {
  switch (x) {
    case 'stderr':
      return process.stderr;
    case 'stdout':
      return process.stdout;
    case 'drop':
      return undefined;
  }
}

function isNoticesMessage(msg: IoMessage<unknown>) {
  return IO.CDK_TOOLKIT_I0100.is(msg) || IO.CDK_TOOLKIT_W0101.is(msg) || IO.CDK_TOOLKIT_E0101.is(msg) || IO.CDK_TOOLKIT_I0101.is(msg);
}
