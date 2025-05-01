import type * as cxapi from '@aws-cdk/cx-api';
import { StackCollection } from './stack-collection';
import type { IoHelper } from '../io/private/io-helper';
export interface IStackAssembly {
    /**
     * The directory this CloudAssembly was read from
     */
    directory: string;
    /**
     * Select a single stack by its ID
     */
    stackById(stackId: string): StackCollection;
}
/**
 * When selecting stacks, what other stacks to include because of dependencies
 */
export declare enum ExtendedStackSelection {
    /**
     * Don't select any extra stacks
     */
    None = 0,
    /**
     * Include stacks that this stack depends on
     */
    Upstream = 1,
    /**
     * Include stacks that depend on this stack
     */
    Downstream = 2
}
/**
 * A single Cloud Assembly and the operations we do on it to deploy the artifacts inside
 */
export declare abstract class BaseStackAssembly implements IStackAssembly {
    readonly assembly: cxapi.CloudAssembly;
    /**
     * Sanitize a list of stack match patterns
     */
    protected static sanitizePatterns(patterns: string[]): string[];
    /**
     * The directory this CloudAssembly was read from
     */
    readonly directory: string;
    /**
     * The IoHelper used for messaging
     */
    protected readonly ioHelper: IoHelper;
    constructor(assembly: cxapi.CloudAssembly, ioHelper: IoHelper);
    /**
     * Select a single stack by its ID
     */
    stackById(stackId: string): StackCollection;
    protected selectMatchingStacks(stacks: cxapi.CloudFormationStackArtifact[], patterns: string[], extend?: ExtendedStackSelection): Promise<StackCollection>;
    protected extendStacks(matched: cxapi.CloudFormationStackArtifact[], all: cxapi.CloudFormationStackArtifact[], extend?: ExtendedStackSelection): Promise<StackCollection>;
}
