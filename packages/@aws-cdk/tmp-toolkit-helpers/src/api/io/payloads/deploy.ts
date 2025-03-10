import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import type { IManifestEntry } from 'cdk-assets';
import type { PermissionChangeType } from './diff';
import type { ConfirmationRequest } from './types';

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
}

export type DeployStackResult =
  | SuccessfulDeployStackResult
  | NeedRollbackFirstDeployStackResult
  | ReplacementRequiresRollbackStackResult
  ;

/** Successfully deployed a stack */
export interface SuccessfulDeployStackResult {
  readonly type: 'did-deploy-stack';
  readonly noOp: boolean;
  readonly outputs: { [name: string]: string };
  readonly stackArn: string;
}

/** The stack is currently in a failpaused state, and needs to be rolled back before the deployment */
export interface NeedRollbackFirstDeployStackResult {
  readonly type: 'failpaused-need-rollback-first';
  readonly reason: 'not-norollback' | 'replacement';
  readonly status: string;
}

/** The upcoming change has a replacement, which requires deploying with --rollback */
export interface ReplacementRequiresRollbackStackResult {
  readonly type: 'replacement-requires-rollback';
}

export interface StackDeployProgress {
  /**
   * Uniquely identifies this marker amongst concurrent messages
   *
   * This is an otherwise meaningless identifier.
   */
  readonly marker: string;
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
}

export interface BuildAsset {
  /**
   * Uniquely identifies this marker amongst concurrent messages
   *
   * This is an otherwise meaningless identifier.
   */
  readonly marker: string;
  /**
   * The asset that is build
   */
  readonly asset: IManifestEntry;
}

export interface PublishAsset {
  /**
   * Uniquely identifies this marker amongst concurrent messages
   *
   * This is an otherwise meaningless identifier.
   */
  readonly marker: string;

  /**
   * The asset that is published
   */
  readonly asset: IManifestEntry;
}
