import type { TemplateDiff } from '@aws-cdk/cloudformation-diff';
import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import type { IManifestEntry } from 'cdk-assets';
import type { PermissionChangeType } from './diff';
import type { ConfirmationRequest } from './types';

// re-export so they are part of the public API
export type { DeployStackResult, SuccessfulDeployStackResult, NeedRollbackFirstDeployStackResult, ReplacementRequiresRollbackStackResult } from '../api/deployments/deployment-result';

export interface StackDeployProgress {
  /**
   * The total number of stacks being deployed
   */
  readonly total: number;
  /**
   * The count of the stack currently attempted to be deployed
   *
   * This is counting value, not an identifier.
   */
  readonly current: number;
  /**
   * The stack that's currently being deployed
   */
  readonly stack: CloudFormationStackArtifact;
}

/**
 * Payload for a yes/no confirmation in deploy. Includes information on
 * what kind of change is being made.
 */
export interface DeployConfirmationRequest extends ConfirmationRequest {
  /**
   * The type of change being made to the IAM permissions.
   */
  readonly permissionChangeType: PermissionChangeType;

  /**
   * The template diffs of the stack
   */
  readonly templateDiffs: { [name: string]: TemplateDiff };
}

export interface BuildAsset {
  /**
   * The asset that is build
   */
  readonly asset: IManifestEntry;
}

export interface PublishAsset {

  /**
   * The asset that is published
   */
  readonly asset: IManifestEntry;
}
