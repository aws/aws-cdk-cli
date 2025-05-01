import type * as cxapi from '@aws-cdk/cx-api';
import type { SDK } from './aws-auth';
import type { CloudFormationStack } from './cloudformation';
import { type IoHelper } from './io/private';
export declare const DEFAULT_TOOLKIT_STACK_NAME = "CDKToolkit";
/**
 * Information on the Bootstrap stack of the environment we're deploying to.
 *
 * This class serves to:
 *
 * - Inspect the bootstrap stack, and return various properties of it for successful
 *   asset deployment (in case of legacy-synthesized stacks).
 * - Validate the version of the target environment, and nothing else (in case of
 *   default-synthesized stacks).
 *
 * An object of this type might represent a bootstrap stack that could not be found.
 * This is not an issue unless any members are used that require the bootstrap stack
 * to have been found, in which case an error is thrown (default-synthesized stacks
 * should never run into this as they don't need information from the bootstrap
 * stack, all information is already encoded into the Cloud Assembly Manifest).
 *
 * Nevertheless, an instance of this class exists to serve as a cache for SSM
 * parameter lookups (otherwise, the "bootstrap stack version" parameter would
 * need to be read repeatedly).
 *
 * Called "ToolkitInfo" for historical reasons.
 *
 */
export declare abstract class ToolkitInfo {
    static determineName(overrideName?: string): string;
    static lookup(environment: cxapi.Environment, sdk: SDK, ioHelper: IoHelper, stackName: string | undefined): Promise<ToolkitInfo>;
    static fromStack(stack: CloudFormationStack): ToolkitInfo;
    static bootstrapStackNotFoundInfo(stackName: string): ToolkitInfo;
    static bootstrapStackLookupError(stackName: string, e: Error): ToolkitInfo;
    abstract readonly found: boolean;
    abstract readonly bucketUrl: string;
    abstract readonly bucketName: string;
    abstract readonly repositoryName: string;
    abstract readonly version: number;
    abstract readonly variant: string;
    abstract readonly bootstrapStack: CloudFormationStack;
    abstract readonly stackName: string;
    constructor();
}
export interface EcrRepositoryInfo {
    repositoryUri: string;
}
export interface EcrCredentials {
    username: string;
    password: string;
    endpoint: string;
}
