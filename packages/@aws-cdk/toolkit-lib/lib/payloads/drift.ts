import type * as cxapi from '@aws-cdk/cx-api';
import type { DriftResult } from '../actions';

export interface DriftResultPayload {
  /**
   * The stack that's currently being checked for drift
   */
  readonly stack: cxapi.CloudFormationStackArtifact;

  /**
   * The drift result for this stack specifically
   */
  readonly drift: DriftResult;
}
