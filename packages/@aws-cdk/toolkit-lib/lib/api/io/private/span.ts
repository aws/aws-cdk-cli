import * as util from 'node:util';
import * as uuid from 'uuid';
import type { ActionLessMessage, ActionLessRequest, IoHelper } from './io-helper';
import type * as make from './message-maker';
import type { Duration } from '../../../payloads/types';
import { formatTime } from '../../../util';
import type { IActionAwareIoHost } from '../io-host';
import type { IoDefaultMessages } from './io-default-messages';

/**
 * These data fields are automatically added by ending a span
 */
export interface SpanEnd {
  readonly duration: number;
  readonly counters?: Record<string, number>;
}

/**
 * Describes a specific span
 *
 * A span definition is a pair of `IoMessageMaker`s to create a start and end message of the span respectively.
 * It also has a display name, that is used for auto-generated message text when they are not provided.
 */
export interface SpanDefinition<S extends object, E extends SpanEnd> {
  readonly name: string;
  readonly start: make.IoMessageMaker<S>;
  readonly end: make.IoMessageMaker<E>;
}


/**
 * Arguments to the span.end() function
 *
 * `SpanEnd` represents fields that are added by the underlying `end` function.
 *
 * - In principle, the intersection of the underlying type and the SpanEnd keys
 *   are made optional, the rest is the same as the underlying type.
 * - If the expected type is subsumed by the SpanEnd type, then either void or
 *   their intersection with all fields optional.
 */
type SpanEndArguments<T> = keyof T extends keyof SpanEnd
  ? (Pick<Partial<SpanEnd>, keyof T & keyof SpanEnd> | void)
  : Optional<T, keyof T & keyof SpanEnd>;

/**
 * Used in conditional types to check if a type (e.g. after omitting fields) is an empty object
 * This is needed because counter-intuitive neither `object` nor `{}` represent that.
 */
type EmptyObject = Record<string, never>;

/**
 * Helper type to force a parameter to be not present of the computed type is an empty object
 */
type VoidWhenEmpty<T> = T extends EmptyObject ? void : T;

/**
 * Make some properties optional
 */
type Optional<T, K extends keyof T> = Omit<T, K> & Pick<Partial<T>, K>;

/**
 * Ending the span returns the observed duration
 */
export interface ElapsedTime {
  readonly asMs: number;
  readonly asSec: number;
}

/**
 * A message span that can be ended and read times from
 */
export interface IMessageSpan<E extends SpanEnd> extends IActionAwareIoHost {
  /**
   * An IoHelper wrapped around the span.
   */
  readonly asHelper: IoHelper;
  /**
   * An IoDefaultMessages wrapped around the span.
   */
  readonly defaults: IoDefaultMessages;

  /**
   * Get the time elapsed since the start
   */
  elapsedTime(): Promise<ElapsedTime>;
  /**
   * Sends a simple, generic message with the current timing
   * For more complex intermediate messages, get the `elapsedTime` and use `notify`
   */
  timing(maker: make.IoMessageMaker<Duration>, message?: string): Promise<ElapsedTime>;
  /**
   * End the span with a payload
   */
  end(payload: SpanEndArguments<E>): Promise<ElapsedTime>;
  /**
   * End the span with a message and payload
   */
  end(message: string, payload: SpanEndArguments<E>): Promise<ElapsedTime>;

  /**
   * Increment a counter
   */
  incCounter(name: string, delta?: number): void;

  /**
   * Return a new timer object
   *
   * It will be added into the span data when it's stopped. All open timers are
   * automatically stopped when the span is ended.
   *
   * Timers are ultimately added to the `counters` array with `<name>_ms` and
   * `<name>_cnt` keys.
   */
  startTimer(name: string): ITimer;
}

/**
 * A timer to time an operation in a span.
 */
export interface ITimer {
  stop(): void;
}

/**
 * Helper class to make spans around blocks of work
 *
 * Blocks are enclosed by a start and end message.
 * All messages of the span share a unique id.
 * The end message contains the time passed between start and end.
 */
export class SpanMaker<S extends object, E extends SpanEnd> {
  private readonly definition: SpanDefinition<S, E>;
  private readonly ioHelper: IoHelper;
  private makeHelper: (ioHost: IActionAwareIoHost) => IoHelper;

  public constructor(ioHelper: IoHelper, definition: SpanDefinition<S, E>, makeHelper: (ioHost: IActionAwareIoHost) => IoHelper) {
    this.definition = definition;
    this.ioHelper = ioHelper;
    this.makeHelper = makeHelper;
  }

  /**
   * Starts the span and initially notifies the IoHost
   * @returns a message span
   */
  public async begin(payload: VoidWhenEmpty<S>): Promise<IMessageSpan<E>>;
  public async begin(message: string, payload: S): Promise<IMessageSpan<E>>;
  public async begin(a: any, b?: S): Promise<IMessageSpan<E>> {
    const span = new MessageSpan(this.ioHelper, this.definition, this.makeHelper);
    const startInput = parseArgs<S>(a, b);
    const startMsg = startInput.message ?? `Starting ${this.definition.name} ...`;
    const startPayload = startInput.payload;
    await span.notify(this.definition.start.msg(startMsg, startPayload));

    return span;
  }
}

class MessageSpan<S extends object, E extends SpanEnd> implements IMessageSpan<E> {
  public readonly asHelper: IoHelper;

  private readonly definition: SpanDefinition<S, E>;
  private readonly ioHelper: IoHelper;
  private readonly spanId: string;
  private readonly startTime: number;
  private readonly timingMsgTemplate: string;
  private readonly counters: Record<string, number> = {};
  private readonly openTimers = new Set<ITimer>();

  public constructor(ioHelper: IoHelper, definition: SpanDefinition<S, E>, makeHelper: (ioHost: IActionAwareIoHost) => IoHelper) {
    this.definition = definition;
    this.ioHelper = ioHelper;
    this.spanId = uuid.v4();
    this.startTime = new Date().getTime();
    this.timingMsgTemplate = '\n✨  %s time: %ds\n';
    this.asHelper = makeHelper(this);
  }

  public get defaults(): IoDefaultMessages {
    return this.asHelper.defaults;
  }

  public async elapsedTime(): Promise<ElapsedTime> {
    return this.time();
  }
  public async timing(maker: make.IoMessageMaker<Duration>, message?: string): Promise<ElapsedTime> {
    const duration = this.time();
    const timingMsg = message ? message : util.format(this.timingMsgTemplate, this.definition.name, duration.asSec);
    await this.notify(maker.msg(timingMsg, {
      duration: duration.asMs,
    }));
    return duration;
  }
  public async notify(msg: ActionLessMessage<unknown>): Promise<void> {
    return this.ioHelper.notify(withSpanId(this.spanId, msg));
  }
  public async end(x: any, y?: SpanEndArguments<E>): Promise<ElapsedTime> {
    const duration = this.time();

    for (const t of this.openTimers) {
      t.stop();
    }
    this.openTimers.clear();

    const endInput = parseArgs<SpanEndArguments<E>>(x, y);
    const endMsg = endInput.message ?? util.format(this.timingMsgTemplate, this.definition.name, duration.asSec);
    const endPayload = endInput.payload;

    await this.notify(this.definition.end.msg(
      endMsg, {
        duration: duration.asMs,
        ...(Object.keys(this.counters).length > 0 ? { counters: this.counters } : {}),
        ...endPayload,
      } as E));

    return duration;
  }

  public incCounter(name: string, delta: number = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + delta;
  }

  public async requestResponse<T>(msg: ActionLessRequest<unknown, T>): Promise<T> {
    return this.ioHelper.requestResponse(withSpanId(this.spanId, msg));
  }

  public startTimer(name: string): ITimer {
    const start = Date.now();

    const t: ITimer = {
      stop: () => {
        this.openTimers.delete(t);
        this.incCounter(`${name}_ms`, Math.floor(Date.now() - start) / 1000);
        this.incCounter(`${name}_cnt`, 1);
      },
    };
    this.openTimers.add(t);
    return t;
  }

  private time() {
    const elapsedTime = new Date().getTime() - this.startTime;
    return {
      asMs: elapsedTime,
      asSec: formatTime(elapsedTime),
    };
  }
}

function parseArgs<S>(first: any, second?: S): { message: string | undefined; payload: S } {
  const firstIsMessage = typeof first === 'string';

  // When the first argument is a string or we have a second argument, then the first arg is the message
  const message = (firstIsMessage || second) ? first : undefined;

  // When the first argument is a string or we have a second argument,
  // then the second arg is the payload, otherwise the first arg is the payload
  const payload = (firstIsMessage || second) ? second : first;

  return {
    message,
    payload,
  };
}

function withSpanId<T extends object>(span: string, message: T): T & { span: string } {
  return {
    ...message,
    span,
  };
}
