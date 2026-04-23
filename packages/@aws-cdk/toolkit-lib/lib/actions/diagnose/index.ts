import type { StackSelector } from '../../api/cloud-assembly/stack-selector';
import type { SourceTrace } from '../../api/source-tracing/types';

export interface DiagnoseOptions {
  readonly stacks?: StackSelector;

  /**
   * How many stacks to do in parallel.
   *
   * @default 10
   */
  readonly concurrency?: number;

  /**
   * Toolkit stack name
   */
  readonly toolkitStackName?: string;
}

export interface DiagnoseResult {
  readonly stacks: DiagnosedStack[];
}

export type StackDiagnosis =
  | { type: 'no-problem' }
  | { type: 'problem'; detectedBy: StackProblemSource; problems: TracedResourceError[] }
  | { type: 'error-diagnosing'; message: string };

export type StackProblemSource =
  | { type: 'deployment'; stackStatus: string; statusReason: string }
  | { type: 'change-set'; changeSetName: string; changeSetStatus: string; statusReason: string }
  | { type: 'early-validation'; changeSetName: string };

export interface DiagnosedStack {
  readonly stackName: string;
  readonly hierarchicalId: string;
  readonly result: StackDiagnosis;
}

export interface TracedResourceError {
  /**
   * The stack this resource error occurred in
   *
   * NOTE: This will be a stack ID (which is a full ARN including the unique identifier),
   * not just a name.
   */
  readonly stackId: string;

  /**
   * Top-level stack name or stack construct path we found the error in
   */
  readonly topLevelStackHierarchicalId: string;

  /**
   * IDs of parent stacks of the resource, in case of resources in nested stacks
   */
  readonly parentStackLogicalIds: string[];

  /**
   * Logical ID of the resource
   *
   * (May be absent in case this message is about the stack itself)
   */
  readonly logicalId?: string;

  /**
   * Resource type
   */
  readonly resourceType?: string;

  /**
   * Physical ID of the resource
   */
  readonly physicalId?: string;

  /**
   * Error message of the resource
   */
  readonly message: string;

  /**
   * Error code of the resource
   */
  readonly errorCode?: string;

  /**
   * Optionally a source trace
   *
   * (Not optional on purpose so we are not allowed to forget to call the code that should fill it)
   */
  readonly sourceTrace: SourceTrace | undefined;
}
