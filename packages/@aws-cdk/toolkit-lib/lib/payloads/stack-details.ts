import type * as cxschema from '@aws-cdk/cloud-assembly-schema';
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
  metadata?: { [path: string]: cxschema.MetadataEntry[] };
  dependencies: StackDependency[];
}

