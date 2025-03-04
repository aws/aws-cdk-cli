import { IIoHost } from '../io-host';
import { IoMessage, IoRequest } from '../io-message';
import { ToolkitAction } from '../toolkit-action';

export type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
export type SimplifiedMessage<T> = Pick<IoMessage<T>, 'level' | 'code' | 'message' | 'data'>;
export type ActionLessMessage<T> = Omit<IoMessage<T>, 'action'>;
export type ActionLessRequest<T, U> = Omit<IoRequest<T, U>, 'action'>;

/**
 * Helper type for IoHosts that are action aware
 */
export interface ActionAwareIoHost extends IIoHost {
  notify<T>(msg: ActionLessMessage<T>): Promise<void>;
  requestResponse<T, U>(msg: ActionLessRequest<T, U>): Promise<U>;
}

/**
 * An IoHost wrapper that adds the given action to an actionless message before
 * sending the message to the given IoHost
 */
export function withAction(ioHost: IIoHost, action: ToolkitAction): ActionAwareIoHost {
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
