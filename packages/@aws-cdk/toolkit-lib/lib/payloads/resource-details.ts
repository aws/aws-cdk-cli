/**
 * Details about a CloudFormation resource
 */
export interface ResourceDetails {
  /**
   * The stack containing this resource
   */
  readonly stackId: string;

  /**
   * The CloudFormation logical ID
   */
  readonly logicalId: string;

  /**
   * The CloudFormation resource type (e.g., AWS::Lambda::Function)
   */
  readonly type: string;

  /**
   * The CDK construct path (from aws:cdk:path metadata)
   * Will be '<unknown>' if metadata is not available
   */
  readonly constructPath: string;

  /**
   * Resources this resource depends on (from DependsOn)
   */
  readonly dependsOn: string[];

  /**
   * Cross-stack imports (from Fn::ImportValue)
   */
  readonly imports: string[];

  /**
   * The removal policy if specified
   */
  readonly removalPolicy?: 'retain' | 'destroy' | 'snapshot';
}

/**
 * Extended details for --explain output
 */
export interface ResourceExplainDetails extends ResourceDetails {
  /**
   * The Condition attached to this resource, if any
   */
  readonly condition?: string;

  /**
   * Update policy if specified
   */
  readonly updatePolicy?: string;

  /**
   * Creation policy if specified
   */
  readonly creationPolicy?: string;
}
