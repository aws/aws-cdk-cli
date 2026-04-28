
/**
 * Enough information to locate a certain CloudFormation resource in a CDK app
 */
export interface SourceTrace {
  readonly constructPath: string;
  readonly creationStackTrace?: string[];
  readonly mutationStackTraces?: string[][];
}
