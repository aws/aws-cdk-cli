/**
 * Interface for IO operations used in drift detection
 */
export interface IDriftIoHelper {
  /**
   * Send a notification
   */
  notify(msg: any): Promise<void>;
}

/**
 * Interface for CloudFormation client used in drift detection
 */
export interface IDriftCloudFormationClient {
  /**
   * Detect drift in a CloudFormation stack
   */
  detectStackDrift(params: { StackName: string }): Promise<{ StackDriftDetectionId?: string }>;

  /**
   * Describe the status of a stack drift detection operation
   */
  describeStackDriftDetectionStatus(params: {
    StackDriftDetectionId: string;
  }): Promise<any>;

  /**
   * Describe the drift of resources in a CloudFormation stack
   */
  describeStackResourceDrifts(params: {
    StackName: string;
  }): Promise<any>;
}
