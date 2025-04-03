import * as util from 'node:util';
import * as uuid from 'uuid';
import type { ActionLessMessage, IoHelper } from './io-helper';
import type { IoMessageMaker } from './message-maker';
import type { Duration } from '../../../payloads';
import { formatTime } from '../../../util';

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
  readonly start: IoMessageMaker<S>;
  readonly end: IoMessageMaker<E>;
}

/**
 * Used in conditional types to check if a type (e.g. after omitting fields) is an empty object
 * This is needed because counter-intuitive neither `object` nor `{}` represent that.
 */
type EmptyObject = {
  [index: string | number | symbol]: never;
}

/**
 * Helper type to force a parameter to be not present of the computed type is an empty object
 */
type VoidWhenEmpty<T> = T extends EmptyObject ? void : T

/**
 * Helper type to force a parameter to be an empty object if the computed type is an empty object
 * This is weird, but some computed types (e.g. using `Omit`) don't end up enforcing this.
 */
type ForceEmpty<T> = T extends EmptyObject ? EmptyObject : T

/**
 * Make some properties optional
 */
type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

/**
 * Ending the span returns the observed duration
 */
interface ElapsedTime {
  readonly asMs: number;
  readonly asSec: number;
}

/**
 * A message span that can be ended and read times from
 */
export interface IMessageSpan<E extends SpanEnd> {
  /**
   * Get the time elapsed since the start
   */
  elapsedTime(): Promise<ElapsedTime>;
  /**
   * Sends a simple, generic message with the current timing
   * For more complex intermediate messages, get the `elapsedTime` and use `notify`
   */
  timing(maker: IoMessageMaker<Duration>, message?: string): Promise<ElapsedTime>;
  /**
   * Sends an arbitrary intermediate message as part of the span
   */
  notify(message: ActionLessMessage<unknown>): Promise<void>;
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

  public constructor(ioHelper: IoHelper, definition: SpanDefinition<S, E>) {
    this.definition = definition;
    this.ioHelper = ioHelper;
  }

  /**
   * Starts the span and initially notifies the IoHost
   * @returns a message span
   */
  public async begin(payload: VoidWhenEmpty<S>): Promise<IMessageSpan<E>>;
  public async begin(message: string, payload: S): Promise<IMessageSpan<E>>;
  public async begin(a: any, b?: S): Promise<IMessageSpan<E>> {
    const spanId = uuid.v4();
    const startTime = new Date().getTime();

    const notify = (msg: ActionLessMessage<unknown>): Promise<void> => {
      return this.ioHelper.notify(withSpanId(spanId, msg));
    };

    const startInput = parseArgs<S>(a, b);
    const startMsg = startInput.message ?? `Starting ${this.definition.name} ...`;
    const startPayload = startInput.payload;

    await notify(this.definition.start.msg(
      startMsg,
      startPayload,
    ));

    const timingMsgTemplate = '\n✨  %s time: %ds\n';
    const time = () => {
      const elapsedTime = new Date().getTime() - startTime;
      return {
        asMs: elapsedTime,
        asSec: formatTime(elapsedTime),
      };
    };

    return {
      elapsedTime: async (): Promise<ElapsedTime> => {
        return time();
      },

      notify: async(msg: ActionLessMessage<unknown>): Promise<void> => {
        await notify(msg);
      },

      timing: async(maker: IoMessageMaker<Duration>, message?: string): Promise<ElapsedTime> => {
        const duration = time();
        const timingMsg = message ? message : util.format(timingMsgTemplate, this.definition.name, duration.asSec);
        await notify(maker.msg(timingMsg, {
          duration: duration.asMs,
        }));
        return duration;
      },

      end: async (x: any, y?: ForceEmpty<Optional<E, keyof SpanEnd>>): Promise<ElapsedTime> => {
        const duration = time();

        const endInput = parseArgs<ForceEmpty<Optional<E, keyof SpanEnd>>>(x, y);
        const endMsg = endInput.message ?? util.format(timingMsgTemplate, this.definition.name, duration.asSec);
        const endPayload = endInput.payload;

        await notify(this.definition.end.msg(
          endMsg, {
            duration: duration.asMs,
            ...endPayload,
          } as E));

        return duration;
      },
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

function withSpanId(span: string, message: ActionLessMessage<unknown>): ActionLessMessage<unknown> {
  return {
    ...message,
    span,
  };
}
