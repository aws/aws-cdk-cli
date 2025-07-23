import type { DataRequest } from './types';

/**
 * Request to confirm or deny the feature flag configuration changes.
 * 
 */
export interface FeatureFlagChangeRequest extends DataRequest {
  readonly flagName: string;
  readonly currentValue?: boolean;
  readonly newValue: boolean;
}