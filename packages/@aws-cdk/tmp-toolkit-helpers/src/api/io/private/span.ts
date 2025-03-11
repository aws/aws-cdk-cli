import * as util from 'node:util';
import * as uuid from 'uuid';
import type { ActionLessMessage, IoHelper } from './io-helper';
import type { IoMessageMaker } from './message-maker';
import { formatTime } from '../../../util';
import type { Duration } from '../payloads/types';

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
  public async begin(first: any, second?: S): Promise<IMessageSpan<E>> {
    const spanId = uuid.v4();
    const startTime = new Date().getTime();

    const notify = (msg: ActionLessMessage<unknown>): Promise<void> => {
      return this.ioHelper.notify(withSpanId(spanId, msg));
    };

    const startMsg = second ? first : 'Starting %s ...';
    const startPayload = second ?? first;

    await notify(this.definition.start.msg(
      util.format(startMsg, this.definition.name),
      startPayload,
    ));

    const timingMsg = '\n✨  %s time: %ds\n';
    const time = () => {
      const elapsedTime = new Date().getTime() - startTime;
      return {
        asMs: elapsedTime,
        asSec: formatTime(elapsedTime),
      };
    };

    return {
      elapsedTime: async (msg?: ActionLessMessage<object>): Promise<ElapsedTime> => {
        if (msg) {
          await notify({
            ...msg,
            data: msg.data,
          });
        }
        return time();
      },

      notify: async(msg: ActionLessMessage<unknown>): Promise<void> => {
        await notify(msg);
      },

      timing: async(maker: IoMessageMaker<Duration>, message?: string): Promise<ElapsedTime> => {
        const duration = time();
        const endMsg = message ? message : timingMsg;
        await notify(maker.msg(util.format(endMsg, this.definition.name, duration.asSec), {
          duration: duration.asMs,
        }));
        return duration;
      },

      end: async (a: any, b?: ForceEmpty<Optional<E, keyof SpanEnd>>): Promise<ElapsedTime> => {
        const duration = time();
        const endMsg = b ? a : timingMsg;
        const endPayload = b ?? a;

        await notify(this.definition.end.msg(
          util.format(endMsg, this.definition.name, duration.asSec), {
            duration: duration.asMs,
            ...endPayload,
          } as E));

        return duration;
      },
    };
  }
}

function withSpanId(span: string, message: ActionLessMessage<unknown>): ActionLessMessage<unknown> {
  return {
    ...message,
    span,
  };
}
