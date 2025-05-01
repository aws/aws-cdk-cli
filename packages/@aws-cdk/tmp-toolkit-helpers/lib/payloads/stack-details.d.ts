import type * as cxapi from '@aws-cdk/cx-api';
/**
 * The dependencies of a stack.
 */
export interface StackDependency {
    id: string;
    dependencies: StackDependency[];
}
/**
 * Details of a stack.
 */
export interface StackDetails {
    id: string;
    name: string;
    environment: cxapi.Environment;
    dependencies: StackDependency[];
}
