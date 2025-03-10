import type { IIoHost } from '../io-host';
import type { IoMessage, IoRequest } from '../io-message';
import type { ToolkitAction } from '../toolkit-action';
import type { MarkerEnd, MarkerStart, MarkerDefinition } from './marker';
import { Marker } from './marker';

export type ActionLessMessage<T> = Omit<IoMessage<T>, 'action'>;
export type ActionLessRequest<T, U> = Omit<IoRequest<T, U>, 'action'>;

/**
 * A class containing helper tools to interact with IoHost
 */
export class IoHelper implements IIoHost {
  public static fromIoHost(ioHost: IIoHost, action: ToolkitAction) {
    return new IoHelper(ioHost, action);
  }

  private readonly ioHost: IIoHost;
  private readonly action: ToolkitAction;

  private constructor(ioHost: IIoHost, action: ToolkitAction) {
    this.ioHost = ioHost;
    this.action = action;
  }

  /**
   * Forward a message to the IoHost, while injection the current action
   */
  public notify(msg: ActionLessMessage<unknown>): Promise<void> {
    return this.ioHost.notify({
      ...msg,
      action: this.action,
    });
  }

  /**
   * Forward a request to the IoHost, while injection the current action
   */
  public requestResponse<T, U>(msg: ActionLessRequest<T, U>): Promise<U> {
    return this.ioHost.requestResponse({
      ...msg,
      action: this.action,
    });
  }

  /**
   * Create a new marker from a given registry entry
   */
  public marker<S extends MarkerStart, E extends MarkerEnd>(type: MarkerDefinition<S, E>): Marker<S, E> {
    return new Marker(this, type);
  }
}

/**
 * Wraps an IoHost and creates an IoHelper from it
 */
export function asIoHelper(ioHost: IIoHost, action: ToolkitAction): IoHelper {
  return IoHelper.fromIoHost(ioHost, action);
}
