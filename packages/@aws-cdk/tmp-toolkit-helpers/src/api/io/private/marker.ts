import * as util from 'node:util';
import * as uuid from 'uuid';
import type { IoHelper } from './io-helper';
import type { IoMessageMaker } from './message-maker';
import { formatTime } from '../../../util';

export interface MarkerStart {
  readonly marker: string;
}

export interface MarkerEnd {
  readonly marker: string;
  readonly duration: number;
}

/**
 * Describes a specific marker
 *
 * A marker definition is a pair of `IoMessageMaker`s to create a start and end message respectively
 * and a display name that is used to auto-generate messages.
 */
export interface MarkerDefinition<S extends MarkerStart, E extends MarkerEnd> {
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
 * A minimal interface that provides a single function to end the marker
 */
interface CanEndMarker<E extends MarkerEnd> {
  end(payload: VoidWhenEmpty<Omit<E, keyof MarkerEnd>>): Promise<ObservedDuration>;
  end(message: string, payload: ForceEmpty<Omit<E, keyof MarkerEnd>>): Promise<ObservedDuration>;
}

/**
 * Ending the marker returns the observed duration
 */
export interface ObservedDuration {
  readonly marker: string;
  readonly asMs: number;
  readonly asSec: number;
}

/**
 * Helper class to mark task blocks
 *
 * Blocks will be enclosed by a start and end message.
 * Both messages share a unique id.
 * The end message contains the time passed between start and end.
 */
export class Marker<S extends MarkerStart, E extends MarkerEnd> {
  public readonly type: MarkerDefinition<S, E>;
  private readonly ioHelper: IoHelper;
  private startTime: number;
  private id: string;

  public constructor(ioHelper: IoHelper, type: MarkerDefinition<S, E>) {
    this.type = type;
    this.ioHelper = ioHelper;
    this.startTime = new Date().getTime();
    this.id = uuid.v4();
  }

  /**
   * Starts the marker and notifies the IoHost.
   * @returns an object that can end the marker
   */
  public async start(payload: VoidWhenEmpty<Omit<S, keyof MarkerStart>>): Promise<CanEndMarker<E>>;
  public async start(message: string, payload: Omit<S, keyof MarkerStart>): Promise<CanEndMarker<E>>;
  public async start(first: any, second?: Omit<S, keyof MarkerStart>): Promise<CanEndMarker<E>> {
    this.startTime = new Date().getTime();

    const msg = second ? first : 'Starting %s ...';
    const payload = second ?? first;

    await this.ioHelper.notify(this.type.start.msg(
      util.format(msg, this.type.name), {
        marker: this.id,
        ...payload,
      } as S));

    return {
      end: (a: any, b?: Omit<E, keyof MarkerEnd>): Promise<ObservedDuration> => {
        return this.end(a, b);
      },
    } as CanEndMarker<E>;
  }

  /**
   * Ends the current timer as a specified timing and notifies the IoHost.
   * @returns the elapsed time
   */
  private async end(first: any | undefined, second?: Omit<E, keyof MarkerEnd>): Promise<ObservedDuration> {
    const duration = this.time();

    const msg = second ? first : `\n✨  %s time: ${duration.asSec}s\n`;
    const payload = second ?? first;

    await this.ioHelper.notify(this.type.end.msg(
      util.format(msg, this.type.name), {
        marker: this.id,
        duration: duration.asMs,
        ...payload,
      } as E));

    return duration;
  }

  /**
   * Get the current timer for the marker
   * @returns the elapsed time
   */
  private time(): ObservedDuration {
    const elapsedTime = new Date().getTime() - this.startTime;
    return {
      marker: this.id,
      asMs: elapsedTime,
      asSec: formatTime(elapsedTime),
    };
  }
}
