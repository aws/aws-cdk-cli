import type { TypedMapping } from '@aws-cdk/cloudformation-diff';
/**
 * Output of the refactor command
 */
export interface RefactorResult {
    /**
     * Mappings along with the resource type
     */
    readonly typedMappings?: TypedMapping[];
    /**
     * Ambiguous path correspondences, if any
     */
    readonly ambiguousPaths?: [string[], string[]][];
}
