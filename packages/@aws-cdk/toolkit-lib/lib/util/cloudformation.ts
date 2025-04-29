/**
 * Validate SNS topic arn
 */
export function validateSnsTopicArn(arn: string): boolean {
  return /^arn:aws:sns:[a-z0-9\-]+:[0-9]+:[a-z0-9\-\_]+$/i.test(arn);
}

/**
 * Does a Stack Event have an error message based on the status.
 */
export function stackEventHasErrorMessage(status: string): boolean {
  return status.endsWith('_FAILED') || status === 'ROLLBACK_IN_PROGRESS' || status === 'UPDATE_ROLLBACK_IN_PROGRESS';
}

/**
 * Calculate the maximal length of all resource types for a given template.
 *
 * @param template the stack template to analyze
 * @param startWidth the initial width to start with. Defaults to the length of 'AWS::CloudFormation::Stack'.
 * @returns the determined width
 */
export function maxResourceTypeLength(template: any, startWidth = 'AWS::CloudFormation::Stack'.length): number {
  const resources = (template && template.Resources) || {};
  let maxWidth = startWidth;
  for (const id of Object.keys(resources)) {
    const type = resources[id].Type || '';
    if (type.length > maxWidth) {
      maxWidth = type.length;
    }
  }
  return maxWidth;
}
