import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import type * as cxschema from '@aws-cdk/cloud-assembly-schema';

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
  metadata?: { [path: string]: cxschema.MetadataEntry[] };
  dependencies: StackDependency[];
}

