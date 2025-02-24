import { IIoHost } from '../io-host';
import { IoMessage, IoRequest } from '../io-message';

/**
 * Valid reporting categories for messages.
 */
export type IoMessageCodeCategory = 'TOOLKIT' | 'SDK' | 'ASSETS' | 'ASSEMBLY';

/**
 * Code level matching the reporting level.
 */
export type IoCodeLevel = 'E' | 'W' | 'I';

/**
 * A message code at a specific level
 */
export type IoMessageSpecificCode<L extends IoCodeLevel> = `CDK_${IoMessageCodeCategory}_${L}${number}${number}${number}${number}`;

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
