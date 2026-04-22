import type { StackSelector } from '../../api/cloud-assembly/stack-selector';
import type { SourceTraced } from '../../api/source-tracing';
import type { ResourceError } from '../../api/stack-events/resource-errors';
import type { Branded } from '../../util/type-brands';

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

/**
 * A special type for traced resource errors
 *
 * Branded because the sourceTrace field is optional and we don't want to be
 * able to accidentally forget the conversion.
 */
export type TracedResourceError = Branded<SourceTraced<ResourceError>, 'traced-resource-error'>;
