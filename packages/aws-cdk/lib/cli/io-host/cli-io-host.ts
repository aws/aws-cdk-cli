import type { Agent } from 'node:https';
import * as util from 'node:util';
import { RequireApproval } from '@aws-cdk/cloud-assembly-schema';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import type {
  HotswapResult, IIoHost, IoEmitter, IoMessage, IoMessageCode, IoMessageLevel, IoRequest,
  MessageListenerResult, MessageMatcher, ToolkitAction,
} from '@aws-cdk/toolkit-lib';
import chalk from 'chalk';
import * as promptly from 'promptly';
import type { IoHelper, ActivityPrinterProps, IActivityPrinter, IoDefaultMessages, ListenerVerdict } from '../../../lib/api-private';
import { asIoHelper, IO, isMessageRelevantForLevel, CurrentActivityPrinter, HistoryActivityPrinter, ErrorsOnlyActivityPrinter, attachListeners, matchAny } from '../../../lib/api-private';
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
  | 'lsp'
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
 * How an IoHost processed a single message or request.
 *
 * This describes the message *as the host handled it*, which can differ from
 * what was emitted: listeners may rewrite the text or level, prevent it from
 * being written at all, or (for requests) answer it on the user's behalf.
 *
 * Both notifications (`notify`) and requests (`requestResponse`) are reported,
 * so an observer sees the complete, ordered stream the host handled. Use
 * `type` to tell them apart.
 *
 * The listener layer computes this, so it is exactly `ListenerVerdict`. Named
 * here because that is the vocabulary the CLI's own observers are written in.
 */
export type IoMessageObservation = ListenerVerdict;

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
   * Register an observer that is invoked for every message the host handles —
   * both notifications and requests — with the disposition the host computed
   * for it (its effective form after listeners and whether it was dropped). For
   * a request, the resolved answer is the effective message's `defaultResponse`.
   * Returns a function that removes the observer again.
   */
  observeMessages(observer: (observation: IoMessageObservation) => void): () => void;
}

/**
 * The listener surface of a `CliIoHost`.
 *
 * `CliIoHost` does not implement these itself: every instance is handed out
 * wrapped by `attachListeners`, which is what supplies them. Merging them into
 * the class type is what lets the CLI call `ioHost.on(...)` on a plain
 * `CliIoHost` annotation, using exactly the surface a programmatic caller gets
 * from the public `withListeners`.
 */
export interface CliIoHost extends IoEmitter {
}

/**
 * A simple IO host for the CLI that writes messages to the console.
 *
 * Instances are always wrapped in the shared listener layer (see
 * `attachListeners`, the private half of the public `withListeners`), so this
 * class is only the *inner* host: it writes messages to streams, prompts for
 * requests, and reports telemetry. Matching, rewriting, dropping, and answering
 * requests all happen in the wrapper, so there is exactly one implementation of
 * them and the CLI is a consumer of it rather than a second copy.
 */
export class CliIoHost implements IIoHost, ObservableIoHost {
  /**
   * Returns the singleton instance
   */
  static instance(props: CliIoHostProps = {}, forceNew = false): CliIoHost {
    if (forceNew || !CliIoHost._instance) {
      CliIoHost._instance = CliIoHost.withListeners(new CliIoHost(props));
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
   * Wrap a freshly constructed host in the listener layer and finish its setup.
   *
   * Everything that registers a listener has to happen here rather than in the
   * constructor, because the listeners live on the wrapper and the wrapper does
   * not exist until the host does.
   */
  private static withListeners(host: CliIoHost): CliIoHost {
    const wrapped = attachListeners(host, (verdict) => host.notifyObservers(verdict));
    host.wrapper = wrapped;

    // Telemetry is registered first so it runs before any other listener: it
    // therefore sees the message as emitted rather than as rewritten, and a
    // later listener's `preventDefault` cannot stop it, so a dropped message is
    // still counted. Both were true before only because no other listener
    // happened to match a telemetry code; now it is guaranteed by ordering.
    // Matches everything, because deciding which messages carry telemetry is
    // `eventFromMessage`'s job and it already ignores the rest.
    wrapped.on(() => true, (msg) => host.maybeEmitTelemetry(msg));

    // Stack-activity messages are handled by the activity printer rather than
    // written to a stream.
    host.routeStackActivityToPrinter();

    return wrapped;
  }

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

  // Observers of how messages are handled (see ObservableIoHost / observeMessages).
  private readonly messageObservers = new Set<(observation: IoMessageObservation) => void>();

  // This host wrapped in the listener layer, i.e. the object every other part of
  // the CLI holds. See `self`.
  private wrapper?: CliIoHost;

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
  }

  /**
   * This host as the rest of the CLI sees it, i.e. wrapped in the listener
   * layer.
   *
   * Methods on the wrapper are bound to the instance, so `this` inside them is
   * this object and not the wrapper. That matters wherever we hand the host to
   * something that will emit through it: passing a bare `this` would hand over
   * the *inner* host, and its messages would then bypass the listeners and go
   * unobserved. Falls back to `this` only before wrapping has happened, which
   * the private constructor makes unreachable from outside.
   */
  private get self(): CliIoHost {
    return this.wrapper ?? this;
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
          ioHost: this.self,
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
          ioHost: this.self,
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
        ioHost: this.self,
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
    // We can always use EVENTS and ERRORS_ONLY
    if (this._progress === StackActivityProgress.EVENTS || this._progress === StackActivityProgress.ERRORS_ONLY) {
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
    return asIoHelper(this.self, this.currentAction as any);
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
        // Write each buffered message out. Straight to `writeMessage`, not back
        // through `notify`: these messages have already been through the
        // listeners, already been observed, and already been counted for
        // telemetry on the way in, so a second pass would repeat all three.
        for (const ioMessage of this.corkedLoggingBuffer) {
          this.writeMessage(ioMessage);
        }
        // remove all buffered messages in-place
        this.corkedLoggingBuffer.splice(0);
      }
    }
  }

  /**
   * Register an observer that is invoked for every message the host handles —
   * both notifications and requests — with the disposition the host computed
   * for it (its effective form after listeners and whether it was dropped). For
   * a request, the resolved answer is the effective message's `defaultResponse`.
   * Returns a function that removes the observer.
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
   * Notifies the host of a message.
   * The caller waits until the notification completes.
   *
   * By the time a message gets here the listener layer has already run, so this
   * is only the write. Messages a listener dropped never arrive.
   */
  public async notify(msg: IoMessage<unknown>): Promise<void> {
    this.writeMessage(msg);
  }

  /**
   * Notify every registered message observer of how a message or request was
   * handled. A no-op when nothing is observing (i.e. outside of tests), so the
   * surrounding hot paths pay nothing in production.
   */
  private notifyObservers(observation: IoMessageObservation): void {
    if (this.messageObservers.size === 0) {
      return;
    }
    for (const observer of this.messageObservers) {
      observer(observation);
    }
  }

  /**
   * Write a (already listener-processed) message to its target stream, honoring
   * the log level and corked-logging buffer. Shared by `notify` and the
   * non-prompting `requestResponse` path.
   */
  private writeMessage(message: IoMessage<unknown>): void {
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

    // A single listener matching any of the activity codes.
    this.self.on(matchAny(IO.CDK_TOOLKIT_I5501, IO.CDK_TOOLKIT_I5502, IO.CDK_TOOLKIT_I5503), route);
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
   * By the time a request gets here the listener layer has already run, so a
   * listener has neither answered it nor suppressed it and this host is the one
   * that has to produce an answer: by prompting the user, or by falling back to
   * the suggested default where it cannot prompt.
   */
  public async requestResponse<DataType, ResponseType>(msg: IoRequest<DataType, ResponseType>): Promise<ResponseType> {
    // Nothing to prompt for, so just show the question and take the default.
    if (!isPromptableRequest(msg)) {
      this.writeMessage(msg);
      return msg.defaultResponse;
    }

    const response = await this.withCorkedLogging(async (): Promise<string | number | boolean> => {
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
          await this.writeMessage({
            ...msg,
            message: `${chalk.cyan(msg.message)} (auto-confirmed)`,
          });
          return true;
        }

        // respond with the default for all other messages
        if (msg.defaultResponse !== undefined) {
          await this.writeMessage({
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
      // The IoHost never aborts on a "no": it returns the answer and lets the
      // calling action decide what to do (so abort handling is consistent
      // across actions).
      if (isConfirmationPrompt(msg)) {
        return promptly.confirm(`${chalk.cyan(msg.message)} (y/n)`);
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
    let message_text;
    if (msg.code === 'CDK_TOOLKIT_E9600') {
      // Message is pre-styled
      message_text = msg.message;
    } else {
      message_text = this.isTTY
        ? styleMap[msg.level](msg.message)
        : msg.message;
    }

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
      case StackActivityProgress.ERRORS_ONLY:
        return new ErrorsOnlyActivityPrinter(props);
    }
  }
}

/**
 * Method decorator that suppresses the given IoHost messages for the duration
 * of the decorated method.
 *
 * Before the method runs, a single `preventDefault` listener covering all
 * given matchers is registered on the instance's `ioHost`; when the method
 * settles (returns or throws), exactly that listener is removed again. This
 * replaces the manual pattern of registering drop-listeners at the top of a
 * method and cleaning them up in a `finally`, and it does not disturb
 * listeners registered elsewhere.
 *
 * The decorated method must be async and live on a class whose instances carry
 * the `CliIoHost` on an `ioHost` property (like `CdkToolkit`).
 *
 * @example
 * class CdkToolkit {
 *   \@suppressMessages(IO.CDK_TOOLKIT_I1001, IO.CDK_TOOLKIT_I1000)
 *   public async metadata(stackName: string, json: boolean) {
 *     // I1001/I1000 are dropped while this runs
 *   }
 * }
 */
export function suppressMessages(...matchers: MessageMatcher[]) {
  return function <A extends any[], R>(
    _target: object,
    _propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<(...args: A) => Promise<R>>,
  ): void {
    const original = descriptor.value;
    if (!original) {
      throw new ToolkitError('InvalidDecoratorTarget', 'suppressMessages can only decorate methods');
    }
    descriptor.value = async function (this: { readonly ioHost: CliIoHost }, ...args: A): Promise<R> {
      using _suppress = this.ioHost.on(matchAny(...matchers), () => ({ preventDefault: true }));
      // `return await` (not a bare `return`) so the listener is only disposed
      // after the method has actually settled.
      return await original.apply(this, args);
    };
  };
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
  return IO.CDK_TOOLKIT_I0100(msg) || IO.CDK_TOOLKIT_W0101(msg) || IO.CDK_TOOLKIT_E0101(msg) || IO.CDK_TOOLKIT_I0101(msg);
}

function eventFromMessage(msg: IoMessage<unknown>): TelemetryEvent | undefined {
  if (CLI_PRIVATE_IO.CDK_CLI_I1001(msg)) {
    return eventResult('SYNTH', msg);
  }
  if (CLI_PRIVATE_IO.CDK_CLI_I2001(msg)) {
    return eventResult('INVOKE', msg);
  }
  if (CLI_PRIVATE_IO.CDK_CLI_I3001(msg)) {
    return eventResult('DEPLOY', msg);
  }
  if (CLI_PRIVATE_IO.CDK_CLI_I3003(msg)) {
    return eventResult('ASSET', msg);
  }
  // Hotswap lives in the cdk-toolkit so it cannot be a CDK_CLI error code.
  // Instead we reuse the existing Hotswap span.
  if (IO.CDK_TOOLKIT_I5410(msg)) {
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
