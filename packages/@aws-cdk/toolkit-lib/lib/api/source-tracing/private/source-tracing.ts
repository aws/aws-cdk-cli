import type { SourceTrace } from '../types';

/**
 * Interface for classes that can trace CloudFormation elements to CDK source
 */
export interface ISourceTracer {
  /**
   * Try to find a source trace for a resource
   */
  traceResource(stackName: string, nestedStackLogicalIds: string[], logicalId: string, propertyName?: string): Promise<SourceTrace | undefined>;

  /**
   * Try to find a source trace for a stack
   */
  traceStack(stackName: string, nestedStackLogicalIds: string[]): Promise<SourceTrace | undefined>;
}

export const NO_SOURCE_TRACE: ISourceTracer = {
  traceResource: () => Promise.resolve(undefined),
  traceStack: () => Promise.resolve(undefined),
};
