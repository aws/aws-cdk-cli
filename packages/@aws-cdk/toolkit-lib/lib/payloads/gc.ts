import type { DataRequest } from './types';

/**
 * Request to confirm or deny the deletion of an assets batch marked for garbage collection.
 */
export interface AssetBatchDeletionRequest extends DataRequest {
  readonly batch: {
    readonly type: 'image' | 'object';
    readonly count: number;
    readonly rollbackBufferDays: number;
    readonly createdBufferDays: number;
  };
}
