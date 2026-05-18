import type { StackEvent } from '@aws-sdk/client-cloudformation';

/**
 * Validate SNS topic arn
 */
export function validateSnsTopicArn(arn: string): boolean {
  return /^arn:aws:sns:[a-z0-9\-]+:[0-9]+:[a-z0-9\-\_]+$/i.test(arn);
}

/**
 * Does a Stack Event have an error message based on the status.
 */
export function isErrorEvent(event: StackEvent): boolean {
  const status = event.ResourceStatus ?? '';
  return status.endsWith('_FAILED') || status === 'ROLLBACK_IN_PROGRESS' || status === 'UPDATE_ROLLBACK_IN_PROGRESS';
}

/**
 * Is this a failure caused by CloudFormation cancelling the deployment?
 *
 * This happens because some other resource failed and CloudFormation decided to stop waiting for this one.
 *
 * Never returns true for the stack event itself, only for resource events.
 */
export function isCancellationEvent(event: StackEvent): boolean {
  return (event.ResourceStatusReason ?? '').indexOf('cancelled') > -1;
}

/**
 * Returns whether this event is about a regular resource (not the root stack and not a nested stack resource)
 */
export function isRegularResourceEvent(event: StackEvent): boolean {
  return event.ResourceType !== 'AWS::CloudFormation::Stack';
}

/**
 * Returns whether this event is about the root stack itself.
 */
export function isRootStackEvent(event: StackEvent): boolean {
  return event.ResourceType === 'AWS::CloudFormation::Stack' && event.PhysicalResourceId === event.StackId;
}

/**
 * Calculate the maximal length of all resource types for a given template.
 *
 * @param template - the stack template to analyze
 * @param startWidth - the initial width to start with. Defaults to the length of 'AWS::CloudFormation::Stack'.
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

/**
 * Extract the stack name from a CloudFormation stack ARN.
 * If the input is already a stack name (not an ARN), returns it as-is.
 *
 * ARN format: arn:<partition>:cloudformation:<region>:<account>:stack/<stack-name>/<unique-id>
 */
export function stackNameFromArn(stackNameOrArn: string): string {
  if (!stackNameOrArn.startsWith('arn:')) {
    return stackNameOrArn;
  }
  return stackNameOrArn.slice(stackNameOrArn.indexOf('/') + 1, stackNameOrArn.lastIndexOf('/'));
}

/**
 * Extract the change set name from a CloudFormation change set ARN.
 * If the input is already a change set name (not an ARN), returns it as-is.
 *
 * ARN format: arn:<partition>:cloudformation:<region>:<account>:changeSet/<changeset-name>/<unique-id>
 */
export function changeSetNameFromArn(changeSetNameOrArn: string): string {
  if (!changeSetNameOrArn.startsWith('arn:')) {
    return changeSetNameOrArn;
  }
  return changeSetNameOrArn.slice(changeSetNameOrArn.indexOf('/') + 1, changeSetNameOrArn.lastIndexOf('/'));
}
