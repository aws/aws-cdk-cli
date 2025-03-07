import type { StackDetails } from '../../api/aws-cdk';
import type { StackSelector } from '../../api/cloud-assembly';

export interface ListOptions {
  /**
   * Select the stacks
   */
  readonly stacks?: StackSelector;
}

export interface StackDetailsPayload {
  stacks: StackDetails[];
}
