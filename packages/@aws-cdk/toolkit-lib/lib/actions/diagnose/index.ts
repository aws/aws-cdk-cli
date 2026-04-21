import { Branded } from "../../util/type-brands";
import { StackSelector } from "../../api/cloud-assembly/stack-selector";
import { SourceTraced } from "../../api/source-tracing";
import { ResourceError } from "../../api/stack-events/resource-errors";

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
  | { type: 'problem'; detectedBy: 'change-set' | 'deployment'; problems: TracedResourceError[] }
  | { type: 'error-diagnosing'; message: string };

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
