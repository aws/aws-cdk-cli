import type { PublishResult } from '../actions';

export interface PublishResultPayload {
  /**
   * The publish result
   */
  readonly result: PublishResult;
}
