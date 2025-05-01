import type * as cxapi from '@aws-cdk/cx-api';
import type { IStackAssembly } from './stack-assembly';
import { type StackDetails } from '../../payloads/stack-details';
/**
 * A collection of stacks and related artifacts
 *
 * In practice, not all artifacts in the CloudAssembly are created equal;
 * stacks can be selected independently, but other artifacts such as asset
 * bundles cannot.
 */
export declare class StackCollection {
    readonly assembly: IStackAssembly;
    readonly stackArtifacts: cxapi.CloudFormationStackArtifact[];
    constructor(assembly: IStackAssembly, stackArtifacts: cxapi.CloudFormationStackArtifact[]);
    get stackCount(): number;
    get firstStack(): cxapi.CloudFormationStackArtifact;
    get stackIds(): string[];
    get hierarchicalIds(): string[];
    withDependencies(): StackDetails[];
    reversed(): StackCollection;
    filter(predicate: (art: cxapi.CloudFormationStackArtifact) => boolean): StackCollection;
    concat(...others: StackCollection[]): StackCollection;
    /**
     * Extracts 'aws:cdk:warning|info|error' metadata entries from the stack synthesis
     */
    validateMetadata(failAt?: 'warn' | 'error' | 'none', logger?: (level: 'info' | 'error' | 'warn', msg: cxapi.SynthesisMessage) => Promise<void>): Promise<void>;
}
