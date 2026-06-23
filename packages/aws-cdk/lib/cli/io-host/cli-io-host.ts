import type { Agent } from 'node:https';
import * as util from 'node:util';
import { RequireApproval } from '@aws-cdk/cloud-assembly-schema';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import type { HotswapResult, IIoHost, IoMessage, IoMessageCode, IoMessageLevel, IoRequest, ToolkitAction } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import * as promptly from 'promptly';
import type { IoHelper, ActivityPrinterProps, IActivityPrinter, IoMessageMaker, IoDefaultMessages } from '../../../lib/api-private';
import { asIoHelper, IO, isMessageRelevantForLevel, CurrentActivityPrinter, HistoryActivityPrinter } from '../../../lib/api-private';
import type { Context } from '../../api/context';
import { StackActivityProgress } from '../../commands/deploy';
import { canCollectTelemetry } from '../telemetry/collect-telemetry';
import { cdkCliErrorName } from '../telemetry/error';
import type { EventResult } from '../telemetry/messages';
import { CLI_PRIVATE_IO } from '../telemetry/messages';
import type { TelemetryEvent } from '../telemetry/session';
import { TelemetrySession } from '../telemetry/session';
import { EndpointTelemetrySink } from '../telemetry/sink/endpoint-sink';
import { FileTelemetrySink } from '../telemetry/sink/file-sink';
import { Funnel } from '../telemetry/sink/funnel';
import type { ITelemetrySink } from '../telemetry/sink/sink-interface';
import { isCI } from '../util/ci';

export type { IIoHost, IoMessage, IoMessageCode, IoMessageLevel, IoRequest };

/**
 * The current action being performed by the CLI. 'none' represents the absence of an action.
 */
type CliAction =
  | ToolkitAction
  | 'context'
  | 'docs'
  | 'flags'
  | 'notices'
  | 'version'
  | 'cli-telemetry'
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

  /**
   * Whether the CLI should attempt to automatically respond to prompts.
   *
   * When true, operation will usually proceed without interactive confirmation.
   * Confirmations are responded to with yes. Other prompts will respond with the default value.
   *
   * @default false
   */
  readonly autoRespond?: boolean;
}

/**
 * A type for configuring a target stream
 */
export type TargetStream = 'stdout' | 'stderr' | 'drop';

/**
 * The result a message listener may return to influence how a message is handled.
 *
 * A listener may update the message _text_ and/or its _level_; it cannot change
 * any other field of the message (such as its `code`), which keeps the
 * code-keyed listener registry valid.
 */
export interface MessageListenerResult {
  /**
   * Replace the text that is printed for this message.
   *
   * @default - the message text is left unchanged
   */
  readonly message?: string;

  /**
   * Override the level of this message.
   *
   * The new level is used for both verbosity filtering and stream selection, so
   * this can move a message between stdout/stderr (e.g. downgrade a `result` to
   * `info`). The `code` is intentionally left unchanged.
   *
   * @default - the message level is left unchanged
   */
  readonly level?: IoMessageLevel;

  /**
   * Skip the default processing of the message, i.e. do not write it to a stream.
   *
   * @default false
   */
  readonly preventDefault?: boolean;
}

/**
 * A registered message listener. Its return value (if any) may update the
 * message text and/or prevent the default processing.
 */
type MessageListenerFn = (msg: IoMessage<any>) => void | MessageListenerResult;
interface MessageListener {
  readonly once: boolean;
  readonly fn: MessageListenerFn;
}

/**
 * How an IoHost processed a single notified message.
 *
 * This describes the message *as the host handled it*, which can differ from
 * what was emitted: listeners may rewrite the text or level, or prevent it from
 * being written at all.
 */
export interface IoMessageObservation {
  /**
   * The message exactly as it was emitted to the host (before any listeners).
   */
  readonly emitted: IoMessage<unknown>;

  /**
   * The message after the host's listeners ran (text and/or level may differ).
   */
  readonly effective: IoMessage<unknown>;

  /**
   * Whether a listener prevented this message from being written, i.e. the user
   * would not see it.
   */
  readonly dropped: boolean;
}

/**
 * An IoHost whose message handling can be observed.
 *
 * This is a CLI-internal contract used by tests to record the *effective*,
 * user-facing message stream (after listeners) without reaching into host
 * internals. It is intentionally separate from `IIoHost` so that the recorder
 * can work with any `IIoHost` and only enrich its output when the host also
 * implements this interface.
 */
export interface ObservableIoHost {
  /**
   * Register an observer that is invoked for every notified message with the
   * disposition the host computed for it. Returns a function that removes the
   * observer again.
   */
  observeMessages(observer: (observation: IoMessageObservation) => void): () => void;
}

/**
 * A simple IO host for the CLI that writes messages to the console.
 */
export class CliIoHost implements IIoHost, ObservableIoHost {
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
   * Returns the singleton instance if it exists
   */
  static get(): CliIoHost | undefined {
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

  private _progress: StackActivityProgress = StackActivityProgress.BAR;

  // Stack Activity Printer
  private activityPrinter?: IActivityPrinter;

  // Corked Logging
  private corkedCounter = 0;
  private readonly corkedLoggingBuffer: IoMessage<unknown>[] = [];

  // Message listeners, keyed by message code. See `on`/`once`/`rewrite`/`rewriteOnce`.
  private readonly messageListeners = new Map<IoMessageCode, MessageListener[]>();

  // Observers of how messages are handled (see ObservableIoHost / observeMessages).
  private readonly messageObservers = new Set<(observation: IoMessageObservation) => void>();

  // True while replaying corked messages, so observers aren't notified twice.
  private corkReplaying = false;

  private readonly autoRespond: boolean;

  /**
   * The telemetry session object
   *
   * Will remain `undefined` if the user has disabled telemetry.
   */
  public telemetry?: TelemetrySession;

  private constructor(props: CliIoHostProps = {}) {
    this.currentAction = props.currentAction ?? 'none';
    this.isTTY = props.isTTY ?? process.stdout.isTTY ?? false;
    this.logLevel = props.logLevel ?? 'info';
    this.isCI = props.isCI ?? isCI();
    this.requireDeployApproval = props.requireDeployApproval ?? RequireApproval.BROADENING;
    this.stackProgress = props.stackProgress ?? StackActivityProgress.BAR;
    this.autoRespond = props.autoRespond ?? false;

    // Stack-activity messages are handled by the activity printer rather than
    // written to a stream. This is wired up as message listeners.
    this.routeStackActivityToPrinter();
  }

  public async startTelemetry(args: any, context: Context, proxyAgent?: Agent) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('../cli-type-registry.json');
    const validCommands = Object.keys(config.commands);
    const cmd = args._[0];
    if (!validCommands.includes(cmd)) {
      // the user typed in an invalid command - no need for telemetry since the invocation is going to fail
      // imminently anyway.
      await this.asIoHelper().defaults.trace(`Session instantiated with an invalid command (${cmd}). Not starting telemetry.`);
      return;
    }

    let sinks: ITelemetrySink[] = [];
    const telemetryFilePath = args['telemetry-file'];
    if (telemetryFilePath) {
      try {
        sinks.push(new FileTelemetrySink({
          ioHost: this,
          logFilePath: telemetryFilePath,
        }));
        await this.asIoHelper().defaults.trace('File Telemetry connected');
      } catch (e: any) {
        await this.asIoHelper().defaults.trace(`File Telemetry instantiation failed: ${e.message}`);
      }
    }

    const telemetryEndpoint = process.env.TELEMETRY_ENDPOINT ?? 'https://cdk-cli-telemetry.us-east-1.api.aws/metrics';
    if (canCollectTelemetry(args, context) && telemetryEndpoint) {
      try {
        sinks.push(new EndpointTelemetrySink({
          ioHost: this,
          agent: proxyAgent,
          endpoint: telemetryEndpoint,
        }));
        await this.asIoHelper().defaults.trace('Endpoint Telemetry connected');
      } catch (e: any) {
        await this.asIoHelper().defaults.trace(`Endpoint Telemetry instantiation failed: ${e.message}`);
      }
    } else {
      await this.asIoHelper().defaults.trace('Endpoint Telemetry NOT connected');
    }

    if (sinks.length > 0) {
      this.telemetry = new TelemetrySession({
        ioHost: this,
        client: new Funnel({ sinks }),
        arguments: args,
        context: context,
      });
    }

    await this.telemetry?.begin();
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

  public get defaults(): IoDefaultMessages {
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
        this.corkReplaying = true;
        try {
          for (const ioMessage of this.corkedLoggingBuffer) {
            await this.notify(ioMessage);
          }
        } finally {
          this.corkReplaying = false;
        }
        // remove all buffered messages in-place
        this.corkedLoggingBuffer.splice(0);
      }
    }
  }

  /**
   * Register a listener that is invoked for every message with the given code.
   *
   * The listener may return a `MessageListenerResult` to update the message
   * text and/or prevent the default processing (writing it to a stream);
   * returning nothing leaves the message untouched. Returns a function that
   * removes the listener again.
   *
   * @example
   * const dispose = ioHost.on(IO.CDK_TOOLKIT_I2901, (msg) => {
   *   myCount += msg.data.stacks.length;
   * });
   */
  public on<T>(code: IoMessageMaker<T>, listener: (msg: IoMessage<T>) => void | MessageListenerResult): () => void {
    return this.addMessageListener(code.code, { once: false, fn: listener as MessageListenerFn });
  }

  /**
   * Register an observer that is invoked for every notified message with the
   * disposition the host computed for it (its effective form after listeners,
   * and whether it was dropped). Returns a function that removes the observer.
   *
   * @see ObservableIoHost
   */
  public observeMessages(observer: (observation: IoMessageObservation) => void): () => void {
    this.messageObservers.add(observer);
    return () => {
      this.messageObservers.delete(observer);
    };
  }

  /**
   * Like `on`, but the listener is automatically removed after it has been
   * invoked once.
   */
  public once<T>(code: IoMessageMaker<T>, listener: (msg: IoMessage<T>) => void | MessageListenerResult): () => void {
    return this.addMessageListener(code.code, { once: true, fn: listener as MessageListenerFn });
  }

  /**
   * Register a formatter that replaces the printed text of messages with the
   * given code. This lets a caller define _how_ a toolkit message is presented
   * without the IoHost needing to know about it.
   *
   * Optionally pass a `level` to also override the message's level (which moves
   * it between stdout/stderr and changes verbosity filtering). For the rarer
   * case of overriding only the level, use `on`/`once` returning `{ level }`.
   *
   * Syntactic sugar for an `on` listener that returns `{ message, level? }`.
   * Returns a function that removes the formatter again.
   *
   * @example
   * const dispose = ioHost.rewrite(IO.CDK_TOOLKIT_I2901, (msg) =>
   *   serializeStructure(msg.data.stacks, true));
   */
  public rewrite<T>(code: IoMessageMaker<T>, formatter: (msg: IoMessage<T>) => string, level?: IoMessageLevel): () => void {
    return this.on(code, (msg) => ({ message: formatter(msg), ...(level !== undefined ? { level } : {}) }));
  }

  /**
   * Like `rewrite`, but the formatter is automatically removed after it has
   * been applied once.
   */
  public rewriteOnce<T>(code: IoMessageMaker<T>, formatter: (msg: IoMessage<T>) => string, level?: IoMessageLevel): () => void {
    return this.once(code, (msg) => ({ message: formatter(msg), ...(level !== undefined ? { level } : {}) }));
  }

  /**
   * Add a listener to the registry and return a function that removes it.
   */
  private addMessageListener(code: IoMessageCode, listener: MessageListener): () => void {
    const listeners = this.messageListeners.get(code) ?? [];
    listeners.push(listener);
    this.messageListeners.set(code, listeners);

    return () => {
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    };
  }

  /**
   * Run all registered listeners for a message's code, in registration order.
   *
   * A listener may update the message text (which is passed on to subsequent
   * listeners and the rest of the pipeline) and/or request that the default
   * processing be skipped. `once` listeners are removed after they have run.
   *
   * Returns the (possibly text-updated) message and whether any listener
   * prevented the default processing.
   */
  private applyMessageListeners(msg: IoMessage<unknown>): { message: IoMessage<unknown>; preventDefault: boolean } {
    let current = msg;
    let preventDefault = false;

    const listeners = msg.code ? this.messageListeners.get(msg.code) : undefined;
    if (listeners && listeners.length > 0) {
      // Iterate over a copy so that `once` listeners can remove themselves safely.
      for (const listener of [...listeners]) {
        const result = listener.fn(current);

        if (listener.once) {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        }

        if (result) {
          if (result.message !== undefined) {
            current = { ...current, message: result.message };
          }
          if (result.level !== undefined) {
            current = { ...current, level: result.level };
          }
          if (result.preventDefault) {
            preventDefault = true;
          }
        }
      }
    }

    return { message: current, preventDefault };
  }

  /**
   * Notifies the host of a message.
   * The caller waits until the notification completes.
   */
  public async notify(msg: IoMessage<unknown>): Promise<void> {
    await this.maybeEmitTelemetry(msg);

    // Run any registered listeners. A listener may update the message text
    // and/or prevent the default processing (e.g. stack-activity messages are
    // routed to the activity printer and not written to a stream).
    const { message, preventDefault } = this.applyMessageListeners(msg);

    // Tell observers how this message was handled (its effective form and
    // whether it was dropped). Skipped while replaying corked messages so each
    // message is observed exactly once.
    if (!this.corkReplaying && this.messageObservers.size > 0) {
      const observation: IoMessageObservation = { emitted: msg, effective: message, dropped: preventDefault };
      for (const observer of this.messageObservers) {
        observer(observation);
      }
    }

    if (preventDefault) {
      return;
    }

    if (!isMessageRelevantForLevel(message, this.logLevel)) {
      return;
    }

    if (this.corkedCounter > 0) {
      this.corkedLoggingBuffer.push(message);
      return;
    }

    const output = this.formatMessage(message);
    const stream = this.selectStream(message);
    stream?.write(output);
  }

  private async maybeEmitTelemetry(msg: IoMessage<unknown>) {
    try {
      const telemetryEvent = eventFromMessage(msg);
      if (telemetryEvent) {
        await this.telemetry?.emit(telemetryEvent);
      }
    } catch (e: any) {
      await this.defaults.trace(`Emit Telemetry Failed ${e.message}`);
    }
  }

  /**
   * Route stack-activity messages to the activity printer (progress bar or
   * event list) rather than writing them to a stream.
   *
   * Implemented as listeners that handle the message via the printer and
   * prevent the default processing, so the rest of the pipeline does not also
   * emit them. The printer is created lazily on the first stack-activity message.
   */
  private routeStackActivityToPrinter() {
    const route = (msg: IoMessage<unknown>): MessageListenerResult => {
      if (!this.activityPrinter) {
        this.activityPrinter = this.makeActivityPrinter();
      }
      this.activityPrinter.notify(msg);
      return { preventDefault: true }; // handled by the printer; don't also write to a stream
    };

    this.on(IO.CDK_TOOLKIT_I5501, route);
    this.on(IO.CDK_TOOLKIT_I5502, route);
    this.on(IO.CDK_TOOLKIT_I5503, route);
  }

  /**
   * Detect special messages encode information about whether or not
   * they require approval
   */
  private skipApprovalStep(msg: IoRequest<any, any>): boolean {
    const approvalToolkitCodes = ['CDK_TOOLKIT_I5060'];
    if (!(msg.code && approvalToolkitCodes.includes(msg.code))) {
      return false;
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

      // Special approval prompt
      // Determine if the message needs approval. If it does, continue (it is a basic confirmation prompt)
      // If it does not, return success (true). We only check messages with codes that we are aware
      // are requires approval codes.
      if (this.skipApprovalStep(msg)) {
        return true;
      }

      // In --yes mode, respond for the user if we can
      if (this.autoRespond) {
        // respond with yes to all confirmations
        if (isConfirmationPrompt(msg)) {
          await this.notify({
            ...msg,
            message: `${chalk.cyan(msg.message)} (auto-confirmed)`,
          });
          return true;
        }

        // respond with the default for all other messages
        if (msg.defaultResponse) {
          await this.notify({
            ...msg,
            message: `${chalk.cyan(msg.message)} (auto-responded with default: ${util.format(msg.defaultResponse)})`,
          });
          return msg.defaultResponse;
        }
      }

      // only talk to user if STDIN is a terminal (otherwise, fail)
      if (!this.isTTY) {
        throw new ToolkitError('TtyNotAttached', `${motivation}, but terminal (TTY) is not attached so we are unable to get a confirmation from the user`);
      }

      // only talk to user if concurrency is 1 (otherwise, fail)
      if (concurrency > 1) {
        throw new ToolkitError('ConcurrencyConflict', `${motivation}, but concurrency is greater than 1 so we are unable to get a confirmation from the user`);
      }

      // Basic confirmation prompt
      // We treat all requests with a boolean response as confirmation prompts
      if (isConfirmationPrompt(msg)) {
        const confirmed = await promptly.confirm(`${chalk.cyan(msg.message)} (y/n)`);
        if (!confirmed) {
          throw new ToolkitError('AbortedByUser', 'Aborted by user');
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
  result: chalk.reset,
  info: chalk.reset,
  debug: chalk.gray,
  trace: chalk.gray,
};

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

function isNoticesMessage(msg: IoMessage<unknown>): msg is IoMessage<void> {
  return IO.CDK_TOOLKIT_I0100.is(msg) || IO.CDK_TOOLKIT_W0101.is(msg) || IO.CDK_TOOLKIT_E0101.is(msg) || IO.CDK_TOOLKIT_I0101.is(msg);
}

function eventFromMessage(msg: IoMessage<unknown>): TelemetryEvent | undefined {
  if (CLI_PRIVATE_IO.CDK_CLI_I1001.is(msg)) {
    return eventResult('SYNTH', msg);
  }
  if (CLI_PRIVATE_IO.CDK_CLI_I2001.is(msg)) {
    return eventResult('INVOKE', msg);
  }
  if (CLI_PRIVATE_IO.CDK_CLI_I3001.is(msg)) {
    return eventResult('DEPLOY', msg);
  }
  if (CLI_PRIVATE_IO.CDK_CLI_I3003.is(msg)) {
    return eventResult('ASSET', msg);
  }
  // Hotswap lives in the cdk-toolkit so it cannot be a CDK_CLI error code.
  // Instead we reuse the existing Hotswap span.
  if (IO.CDK_TOOLKIT_I5410.is(msg)) {
    // Create a telemetry-compatible result
    return hotswapToEventResult(msg.data);
  }
  return undefined;

  function eventResult(eventType: TelemetryEvent['eventType'], m: IoMessage<EventResult>): TelemetryEvent {
    return {
      eventType,
      duration: m.data.duration,
      error: m.data.error,
      counters: m.data.counters,
    };
  }
}

function hotswapToEventResult(result: HotswapResult): TelemetryEvent {
  const nonHotswappableResources: Record<string, number> = {};
  for (const { subject } of result.nonHotswappableChanges) {
    if ('resourceType' in subject) {
      const keys = 'rejectedProperties' in subject && subject.rejectedProperties
        ? subject.rejectedProperties.map(p => `hotswapFallback:${subject.resourceType}#${p}`)
        : [`hotswapFallback:${subject.resourceType}`];
      for (const key of keys) {
        nonHotswappableResources[key] = (nonHotswappableResources[key] ?? 0) + 1;
      }
    }
  }

  return {
    eventType: 'HOTSWAP' as const,
    duration: result.duration,
    ...(result.error ? {
      error: {
        name: cdkCliErrorName(result.error),
      },
    } : {}),
    counters: {
      hotswapped: result.hotswapped ? 1 : 0,
      hotswapFallback: result.hotswapFallback ? 1 : 0,
      hotswappableChanges: result.hotswappableChanges.length,
      nonHotswappableChanges: result.nonHotswappableChanges.length,
      ...nonHotswappableResources,
    },
  };
}
