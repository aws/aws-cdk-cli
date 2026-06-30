import type { Agent } from 'node:https';
import * as util from 'node:util';
import { RequireApproval } from '@aws-cdk/cloud-assembly-schema';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import type { HotswapResult, IIoHost, IoMessage, IoMessageCode, IoMessageLevel, IoRequest, ToolkitAction } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import * as promptly from 'promptly';
import type { IoHelper, ActivityPrinterProps, IActivityPrinter, IoMessageMaker, IoRequestMaker, IoDefaultMessages } from '../../../lib/api-private';
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
  | 'explore'
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
   * Skip the default handling of the message.
   *
   * For a notification this means it is not written to a stream. For a request
   * it stops processing entirely: the user is not prompted, nothing is written,
   * and the request resolves with its (possibly `respond`-overridden) default
   * response.
   *
   * @default false
   */
  readonly preventDefault?: boolean;

  /**
   * For requests only: the value to resolve the request with. It is folded into
   * the request's default response and skips the prompt (the request is treated
   * as not promptable). The question is still written unless `preventDefault` is
   * also set. Ignored for plain notifications.
   *
   * The presence of the key is what matters, so `false`/`0`/`''` are valid
   * answers. Use the `respond`/`respondOnce` helpers for the common case.
   *
   * @default - this listener does not supply a response
   */
  readonly respond?: unknown;
}

/**
 * What a message listener may return: nothing, a `MessageListenerResult`, or a
 * `Promise` of either.
 *
 * Listeners may be async. The host awaits each listener before running the
 * next, so registration order — and the cumulative effect on the message — is
 * preserved regardless of whether listeners are sync or async.
 */
export type MessageListenerResultOrPromise = void | MessageListenerResult | Promise<void | MessageListenerResult>;

/**
 * A registered message listener. Its return value (if any) may update the
 * message text and/or prevent the default processing. It may be async.
 */
type MessageListenerFn = (msg: IoMessage<any>) => MessageListenerResultOrPromise;
interface MessageListener {
  readonly once: boolean;
  readonly fn: MessageListenerFn;
  /**
   * Decides which messages this listener applies to. For a listener registered
   * with a maker this matches by `code`; for one registered with a predicate it
   * is the predicate itself.
   */
  readonly matches: (msg: IoMessage<unknown>) => boolean;
  /**
   * Whether this is one of the host's own internal listeners (e.g. stack-activity
   * routing). Internal listeners are not removed by `removeAllListeners`.
   *
   * @default false - a user listener registered via `on`/`once`/`rewrite`/`respond`
   */
  readonly internal?: boolean;
}

/**
 * Selects which messages a listener applies to.
 *
 * Either a message/request *maker* — the listener fires for messages with that
 * maker's `code` (the original behavior) — or a custom *predicate* over the
 * message. A maker's `.is` type guard (e.g. `IO.CDK_TOOLKIT_I7010.is`) is a
 * convenient predicate, but any `(msg) => boolean` works (e.g. to match a family
 * of codes, or on the message level).
 */
export type MessageSelector<T> =
  | IoMessageMaker<T>
  | IoRequestMaker<T, any>
  | ((msg: IoMessage<any>) => boolean);

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
 */
export interface IoMessageObservation {
  /**
   * Whether this observation describes a plain notification (`notify`) or a
   * request that asked for a response (`requestResponse`).
   */
  readonly type: 'notify' | 'request';

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
   * would not see it. Always `false` for requests (a request is reported once
   * it has been resolved, regardless of how it was answered).
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
   * Register an observer that is invoked for every message the host handles —
   * both notifications and requests — with the disposition the host computed
   * for it (its effective form after listeners and whether it was dropped). For
   * a request, the resolved answer is the effective message's `defaultResponse`.
   * Returns a function that removes the observer again.
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

  // Message listeners in registration order. Each carries a matcher (by code,
  // or a custom predicate). See `on`/`once`/`rewrite`/`respond`.
  private readonly messageListeners: MessageListener[] = [];

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
   * returning nothing leaves the message untouched. The listener may be async
   * (return a `Promise`); the host awaits it before processing the message
   * further. Returns a function that removes the listener again.
   *
   * @example
   * const dispose = ioHost.on(IO.CDK_TOOLKIT_I2901, async (msg) => {
   *   myCount += msg.data.stacks.length;
   *   await persist(myCount);
   * });
   *
   * @example
   * // Match with a custom predicate instead of a code, e.g. a maker's `.is`:
   * const dispose = ioHost.on(IO.CDK_TOOLKIT_I7010.is, (msg) => ({ respond: true }));
   */
  public on<T>(
    selector: IoMessageMaker<T> | IoRequestMaker<T, any> | ((msg: IoMessage<any>) => msg is IoMessage<T>),
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): () => void;
  public on(
    predicate: (msg: IoMessage<any>) => boolean,
    listener: (msg: IoMessage<unknown>) => MessageListenerResultOrPromise,
  ): () => void;
  public on(selector: MessageSelector<any>, listener: MessageListenerFn): () => void {
    return this.addMessageListener({ once: false, fn: listener, matches: messageMatcher(selector) });
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
   * Like `on`, but the listener is automatically removed after it has been
   * invoked once.
   */
  public once<T>(
    selector: IoMessageMaker<T> | IoRequestMaker<T, any> | ((msg: IoMessage<any>) => msg is IoMessage<T>),
    listener: (msg: IoMessage<T>) => MessageListenerResultOrPromise,
  ): () => void;
  public once(
    predicate: (msg: IoMessage<any>) => boolean,
    listener: (msg: IoMessage<unknown>) => MessageListenerResultOrPromise,
  ): () => void;
  public once(selector: MessageSelector<any>, listener: MessageListenerFn): () => void {
    return this.addMessageListener({ once: true, fn: listener, matches: messageMatcher(selector) });
  }

  /**
   * Remove every message listener registered via `on`/`once`/`rewrite`/`respond`.
   *
   * The host's own internal listeners (such as stack-activity routing) are kept,
   * so the host keeps working afterwards. Message observers registered via
   * `observeMessages` are a separate mechanism and are not affected.
   *
   * This is mainly useful for tests that share the singleton host and need to
   * reset listener state between cases (a leftover listener would otherwise
   * leak into the next test).
   */
  public removeAllListeners(): void {
    // Drop user listeners in place (preserving array identity for any
    // outstanding dispose closures); keep the host's internal listeners.
    for (let i = this.messageListeners.length - 1; i >= 0; i--) {
      if (!this.messageListeners[i].internal) {
        this.messageListeners.splice(i, 1);
      }
    }
  }

  /**
   * Answer a request (by its code) on the user's behalf with a fixed value, so
   * the host does not prompt. Syntactic sugar for an `on` listener returning
   * `{ respond: value, preventDefault: suppressQuestion }`; for conditional
   * answers or to also reword the question, use `on`/`once` directly. Returns a
   * function that removes the responder again.
   *
   * @param suppressQuestion - whether to also suppress writing the question text.
   *   Defaults to `true` (answer silently). Pass `false` to still surface the
   *   question while answering it.
   *
   * @example
   * // Under --force, auto-confirm the destroy prompt without prompting.
   * const dispose = ioHost.respond(IO.CDK_TOOLKIT_I7010, true);
   */
  public respond<T, U>(code: IoRequestMaker<T, U>, value: U, suppressQuestion = true): () => void {
    return this.addMessageListener({ once: false, fn: () => ({ respond: value, preventDefault: suppressQuestion }), matches: messageMatcher(code) });
  }

  /**
   * Like `respond`, but the answer is given only once and then removed.
   */
  public respondOnce<T, U>(code: IoRequestMaker<T, U>, value: U, suppressQuestion = true): () => void {
    return this.addMessageListener({ once: true, fn: () => ({ respond: value, preventDefault: suppressQuestion }), matches: messageMatcher(code) });
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
  public rewrite<T>(
    code: IoMessageMaker<T> | IoRequestMaker<T, any>,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): () => void {
    return this.on(code, (msg) => ({ message: formatter(msg), ...(level !== undefined ? { level } : {}) }));
  }

  /**
   * Like `rewrite`, but the formatter is automatically removed after it has
   * been applied once.
   */
  public rewriteOnce<T>(
    code: IoMessageMaker<T> | IoRequestMaker<T, any>,
    formatter: (msg: IoMessage<T>) => string,
    level?: IoMessageLevel,
  ): () => void {
    return this.once(code, (msg) => ({ message: formatter(msg), ...(level !== undefined ? { level } : {}) }));
  }

  /**
   * Add a listener to the registry and return a function that removes it.
   */
  private addMessageListener(listener: MessageListener): () => void {
    this.messageListeners.push(listener);

    return () => {
      const index = this.messageListeners.indexOf(listener);
      if (index >= 0) {
        this.messageListeners.splice(index, 1);
      }
    };
  }

  /**
   * Run every registered listener that matches the message, in registration
   * order. A listener matches by its code (maker) or its custom predicate.
   *
   * A listener may update the message text/level (passed on to subsequent
   * listeners and the rest of the pipeline), prevent the default processing, or
   * (for requests) answer it. `once` listeners are removed after they have run.
   * Matching is decided against the message as emitted, so a rewrite by an
   * earlier listener does not change which later listeners apply.
   *
   * Returns the (possibly updated) message, whether the default processing was
   * prevented, and whether a listener answered the request (and with what).
   */
  private async applyMessageListeners<T extends IoMessage<unknown>>(msg: T): Promise<{
    message: T;
    preventDefault: boolean;
    responded: boolean;
  }> {
    let current = msg;
    let preventDefault = false;
    let responded = false;
    // Iterate over a copy so that `once` listeners can remove themselves safely.
    for (const listener of [...this.messageListeners]) {
      // Match against the emitted message; a listener receives the cumulatively
      // transformed `current` message.
      if (!listener.matches(msg)) {
        continue;
      }

      // Listeners may be async; await each one before running the next so the
      // cumulative effect on the message stays order-deterministic.
      const result = await listener.fn(current);

      if (listener.once) {
        const index = this.messageListeners.indexOf(listener);
        if (index >= 0) {
          this.messageListeners.splice(index, 1);
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
        if ('respond' in result && 'defaultResponse' in msg) {
          // Fold the answer into the request's default response and mark it
          // answered, so we skip prompting and resolve with this value.
          current = { ...current, defaultResponse: result.respond };
          responded = true;
        }
      }
    }

    return { message: current, preventDefault, responded };
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
    const { message, preventDefault } = await this.applyMessageListeners(msg);

    // Tell observers how this message was handled (its effective form and
    // whether it was dropped). Skipped while replaying corked messages so each
    // message is observed exactly once.
    if (!this.corkReplaying) {
      this.notifyObservers({ type: 'notify', emitted: msg, effective: message, dropped: preventDefault });
    }

    if (preventDefault) {
      return;
    }

    this.writeMessage(message);
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

    // A single internal listener (so it survives `removeAllListeners()` and the
    // host keeps routing stack activity) matching any of the activity codes.
    this.addMessageListener({
      once: false,
      internal: true,
      fn: route,
      matches: matchAny(IO.CDK_TOOLKIT_I5501, IO.CDK_TOOLKIT_I5502, IO.CDK_TOOLKIT_I5503),
    });
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
   * Registered listeners run first: a listener may reword the question (its text
   * or level) or answer it outright via `respond` (e.g. `--force` auto-confirms
   * a destroy). If no listener answers and the host cannot prompt, the suggested
   * default response is used.
   */
  public async requestResponse<DataType, ResponseType>(msg: IoRequest<DataType, ResponseType>): Promise<ResponseType> {
    // Listeners run exactly once here (so we don't go back through `notify`):
    // they may answer the request, or reword/relevel the question shown below.
    const { message, ...listenerResult } = await this.applyMessageListeners(msg);

    const response = await this.resolveRequest(message, listenerResult);

    // Tell observers how this request was handled: the effective (possibly
    // reworded) question and the resolved response. A request is reported only
    // once it has been answered, so it is never `dropped`.
    this.notifyObservers({ type: 'request', emitted: msg, effective: message, dropped: false });

    return response;
  }

  /**
   * Resolve a request to its response: a listener's answer if one was given,
   * otherwise the answer prompted from the user, otherwise the suggested
   * default when the host cannot prompt.
   *
   * Kept separate from `requestResponse` so the response can be observed in a
   * single place regardless of which of these paths produced it.
   */
  private async resolveRequest<DataType, ResponseType>(
    msg: IoRequest<DataType, ResponseType>,
    listenerResult: { preventDefault: boolean; responded: boolean },
  ): Promise<ResponseType> {
    // stop processing, a listener has taken care of it
    if (listenerResult.preventDefault) {
      return msg.defaultResponse;
    }

    // if a listener provided a response, we skip interaction
    if (!isPromptableRequest(msg) || listenerResult.responded) {
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
        if (msg.defaultResponse) {
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
 * Convert a `MessageSelector` into a predicate that decides whether a listener
 * applies to a message. A maker matches messages carrying its `code`; a
 * predicate (e.g. a maker's `.is`, or any `(msg) => boolean`) is used as-is.
 */
function messageMatcher(selector: MessageSelector<any>): (msg: IoMessage<unknown>) => boolean {
  if (typeof selector === 'function') {
    return selector;
  }
  const { code } = selector;
  return (msg) => msg.code === code;
}

/**
 * Combine several selectors into a single predicate that matches a message when
 * *any* of them matches. Each selector may be a maker (matched by its `code`)
 * or a predicate.
 *
 * Useful for one listener that spans multiple codes, e.g.
 * `ioHost.on(matchAny(IO.CDK_TOOLKIT_I5501, IO.CDK_TOOLKIT_I5502), listener)`.
 */
export function matchAny(...selectors: MessageSelector<any>[]): (msg: IoMessage<unknown>) => boolean {
  const matchers = selectors.map(messageMatcher);
  return (msg) => matchers.some((matches) => matches(msg));
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
