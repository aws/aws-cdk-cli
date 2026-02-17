import * as util from 'node:util';
import * as uuid from 'uuid';
import type { ActionLessMessage, ActionLessRequest, IoHelper } from './io-helper';
import type * as make from './message-maker';
import type { Duration } from '../../../payloads/types';
import { formatTime } from '../../../util';
import type { IActionAwareIoHost } from '../io-host';
import type { IoDefaultMessages } from './io-default-messages';

export interface SpanEnd {
  readonly duration: number;
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
 * Used in conditional types to check if a type (e.g. after omitting fields) is an empty object
 * This is needed because counter-intuitive neither `object` nor `{}` represent that.
 */
type EmptyObject = {
  [index: string | number | symbol]: never;
};

/**
 * Helper type to force a parameter to be not present of the computed type is an empty object
 */
type VoidWhenEmpty<T> = T extends EmptyObject ? void : T;

/**
 * Helper type to force a parameter to be an empty object if the computed type is an empty object
 * This is weird, but some computed types (e.g. using `Omit`) don't end up enforcing this.
 */
type ForceEmpty<T> = T extends EmptyObject ? EmptyObject : T;

/**
 * Make some properties optional
 */
type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

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
  end(payload: VoidWhenEmpty<Omit<E, keyof SpanEnd>>): Promise<ElapsedTime>;
  /**
   * End the span with a payload, overwriting
   */
  end(payload: VoidWhenEmpty<Optional<E, keyof SpanEnd>>): Promise<ElapsedTime>;
  /**
   * End the span with a message and payload
   */
  end(message: string, payload: ForceEmpty<Optional<E, keyof SpanEnd>>): Promise<ElapsedTime>;
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
  public async end(x: any, y?: ForceEmpty<Optional<E, keyof SpanEnd>>): Promise<ElapsedTime> {
    const duration = this.time();

    const endInput = parseArgs<ForceEmpty<Optional<E, keyof SpanEnd>>>(x, y);
    const endMsg = endInput.message ?? util.format(this.timingMsgTemplate, this.definition.name, duration.asSec);
    const endPayload = endInput.payload;

    await this.notify(this.definition.end.msg(
      endMsg, {
        duration: duration.asMs,
        ...endPayload,
      } as E));

    return duration;
  }

  public async requestResponse<T>(msg: ActionLessRequest<unknown, T>): Promise<T> {
    return this.ioHelper.requestResponse(withSpanId(this.spanId, msg));
  }

  private time() {
    const elapsedTime = new Date().getTime() - this.startTime;
    return {
      asMs: elapsedTime,
      asSec: formatTime(elapsedTime),
    };
  }
}

function parseArgs<S extends object>(first: any, second?: S): { message: string | undefined; payload: S } {
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
