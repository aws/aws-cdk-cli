/**
 * Validate SNS topic arn
 */
export declare function validateSnsTopicArn(arn: string): boolean;
/**
 * Does a Stack Event have an error message based on the status.
 */
export declare function stackEventHasErrorMessage(status: string): boolean;
/**
 * Calculate the maximal length of all resource types for a given template.
 *
 * @param template the stack template to analyze
 * @param startWidth the initial width to start with. Defaults to the length of 'AWS::CloudFormation::Stack'.
 * @returns the determined width
 */
export declare function maxResourceTypeLength(template: any, startWidth?: number): number;
