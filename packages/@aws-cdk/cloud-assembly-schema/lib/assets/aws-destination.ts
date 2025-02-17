/**
 * Destination for assets that need to be uploaded to AWS
 */
export interface AwsDestination {
  /**
   * The region where this asset will need to be published
   *
   * @default - Current region
   */
  readonly region?: string;

  /**
   * The role that needs to be assumed while publishing this asset
   *
   * @default - No role will be assumed
   */
  readonly assumeRoleArn?: string;

  /**
   * The ExternalId that needs to be supplied while assuming this role
   *
   * @default - No ExternalId will be supplied
   */
  readonly assumeRoleExternalId?: string;

  /**
   * Additional options to pass to STS when assuming the role.
   *
   * - `RoleArn` should not be used. Use the dedicated `assumeRoleArn` property instead.
   * - `ExternalId` should not be used. Use the dedicated `assumeRoleExternalId` instead.
   *
   * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/STS.html#assumeRole-property
   * @default - No additional options.
   */
  readonly assumeRoleAdditionalOptions?: { [key: string]: any };
}
