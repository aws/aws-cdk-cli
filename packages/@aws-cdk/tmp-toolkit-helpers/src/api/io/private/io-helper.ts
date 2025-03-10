import type { IIoHost } from '../io-host';
import type { IoMessage, IoRequest } from '../io-message';
import type { ToolkitAction } from '../toolkit-action';

export type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
export type SimplifiedMessage<T> = Pick<IoMessage<T>, 'level' | 'code' | 'message' | 'data'>;
export type ActionLessMessage<T> = Omit<IoMessage<T>, 'action'>;
export type ActionLessRequest<T, U> = Omit<IoRequest<T, U>, 'action'>;

/**
 * Helper for IO messaging.
 *
 * Wraps a client provided IoHost and provides additional features & services to toolkit internal classes.
 */
export interface IoHelper extends IIoHost {
  notify(msg: ActionLessMessage<unknown>): Promise<void>;
  requestResponse<T, U>(msg: ActionLessRequest<T, U>): Promise<U>;
}

/**
 * Wraps an IoHost and creates an IoHelper from it
 */
export function asIoHelper(ioHost: IIoHost, action: ToolkitAction): IoHelper {
  return {
    notify: async <T>(msg: Omit<IoMessage<T>, 'action'>) => {
      await ioHost.notify({
        ...msg,
        action,
      });
    },
    requestResponse: async <T, U>(msg: Omit<IoRequest<T, U>, 'action'>) => {
      return ioHost.requestResponse({
        ...msg,
        action,
      });
    },
  };
}
