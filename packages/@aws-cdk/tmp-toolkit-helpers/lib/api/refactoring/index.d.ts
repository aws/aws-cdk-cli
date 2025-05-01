import type { TypedMapping } from '@aws-cdk/cloudformation-diff';
import type { SdkProvider } from '../aws-auth';
import type { CloudFormationStack } from './cloudformation';
/**
 * Represents a set of possible movements of a resource from one location
 * to another. In the ideal case, there is only one source and only one
 * destination.
 */
export type ResourceMovement = [ResourceLocation[], ResourceLocation[]];
export declare class AmbiguityError extends Error {
    readonly movements: ResourceMovement[];
    constructor(movements: ResourceMovement[]);
    paths(): [string[], string[]][];
}
/**
 * This class mirrors the `ResourceLocation` interface from CloudFormation,
 * but is richer, since it has a reference to the stack object, rather than
 * merely the stack name.
 */
export declare class ResourceLocation {
    readonly stack: CloudFormationStack;
    readonly logicalResourceId: string;
    constructor(stack: CloudFormationStack, logicalResourceId: string);
    toPath(): string;
    getType(): string;
    equalTo(other: ResourceLocation): boolean;
}
/**
 * A mapping between a source and a destination location.
 */
export declare class ResourceMapping {
    readonly source: ResourceLocation;
    readonly destination: ResourceLocation;
    constructor(source: ResourceLocation, destination: ResourceLocation);
    toTypedMapping(): TypedMapping;
}
export declare function resourceMovements(before: CloudFormationStack[], after: CloudFormationStack[]): ResourceMovement[];
export declare function ambiguousMovements(movements: ResourceMovement[]): ResourceMovement[];
/**
 * Converts a list of unambiguous resource movements into a list of resource mappings.
 *
 */
export declare function resourceMappings(movements: ResourceMovement[]): ResourceMapping[];
/**
 * Compares the deployed state to the cloud assembly state, and finds all resources
 * that were moved from one location (stack + logical ID) to another. The comparison
 * is done per environment.
 */
export declare function findResourceMovements(stacks: CloudFormationStack[], sdkProvider: SdkProvider): Promise<ResourceMovement[]>;
export declare function formatTypedMappings(mappings: TypedMapping[]): string;
export declare function formatAmbiguousMappings(paths: [string[], string[]][]): string;
