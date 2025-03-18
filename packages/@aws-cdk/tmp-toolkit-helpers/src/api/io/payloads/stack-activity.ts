import type { MetadataEntry } from '@aws-cdk/cloud-assembly-schema';
import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import type { StackEvent } from '@aws-sdk/client-cloudformation';
import type { StackProgress } from './progress';

/**
 * Payload when stack monitoring is starting or stopping for a given stack deployment.
 */
export interface StackMonitoringControlEvent {
  /**
   * A unique identifier for a specific stack deployment.
   *
   * Use this value to attribute stack activities received for concurrent deployments.
   */
  readonly deployment: string;

  /**
   * The stack artifact that is getting deployed
   */
  readonly stack: CloudFormationStackArtifact;

  /**
   * The name of the Stack that is getting deployed
   */
  readonly stackName: string;

  /**
   * Total number of resources taking part in this deployment
   *
   * The number might not always be known or accurate.
   * Only use for informational purposes and handle the case when it's unavailable.
   */
  readonly resourcesTotal?: number;
}

export interface StackActivity {
  /**
   * A unique identifier for a specific stack deployment.
   *
   * Use this value to attribute stack activities received for concurrent deployments.
   */
  readonly deployment: string;

  /**
   * The Stack Event as received from CloudFormation
   */
  readonly event: StackEvent;

  /**
   * Additional resource metadata
   */
  readonly metadata?: ResourceMetadata;

  /**
   * The stack progress
   */
  readonly progress: StackProgress;
}

export interface ResourceMetadata {
  entry: MetadataEntry;
  constructPath: string;
}
