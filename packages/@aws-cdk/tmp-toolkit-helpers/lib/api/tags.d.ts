import type * as cxapi from '@aws-cdk/cx-api';
/**
 * @returns an array with the tags available in the stack metadata.
 */
export declare function tagsForStack(stack: cxapi.CloudFormationStackArtifact): Tag[];
export interface Tag {
    readonly Key: string;
    readonly Value: string;
}
