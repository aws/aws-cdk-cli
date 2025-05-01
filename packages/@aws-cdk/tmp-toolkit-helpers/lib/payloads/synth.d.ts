import type { StackSelector } from '../api/cloud-assembly/stack-selector';
export interface StackSelectionDetails {
    /**
     * The selected stacks, if any
     */
    readonly stacks: StackSelector;
}
