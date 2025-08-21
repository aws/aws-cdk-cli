import { format } from 'util';
import type { DescribeStackDriftDetectionStatusCommandOutput, DescribeStackResourceDriftsCommandOutput } from '@aws-sdk/client-cloudformation';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { ICloudFormationClient } from '../aws-auth/private';
import type { IoHelper } from '../io/private';

/**
 * Detect drift for a CloudFormation stack and wait for the detection to complete
 *
 * @param cfn - a CloudFormation client
 * @param ioHelper - helper for IO operations
 * @param stackName - the name of the stack to check for drift
 * @returns the CloudFormation description of the drift detection results
 */
export async function detectStackDrift(
  cfn: ICloudFormationClient,
  ioHelper: IoHelper,
  stackName: string,
): Promise<DescribeStackResourceDriftsCommandOutput> {
  // Start drift detection
  const driftDetection = await cfn.detectStackDrift({
    StackName: stackName,
  });

  await ioHelper.defaults.trace(
    format('Detecting drift with ID %s for stack %s...', driftDetection.StackDriftDetectionId, stackName),
  );

  // Wait for drift detection to complete
  const driftStatus = await waitForDriftDetection(cfn, ioHelper, driftDetection.StackDriftDetectionId!);

  if (!driftStatus) {
    throw new ToolkitError('Drift detection took too long to complete. Aborting');
  }

  if (driftStatus?.DetectionStatus === 'DETECTION_FAILED') {
    throw new ToolkitError(
      `Failed to detect drift: ${driftStatus.DetectionStatusReason || 'No reason provided'}`,
    );
  }

  // Handle UNKNOWN stack drift status
  if (driftStatus?.StackDriftStatus === 'UNKNOWN') {
    await ioHelper.defaults.trace(
      'Stack drift status is UNKNOWN. This may occur when CloudFormation is unable to detect drift for at least one resource and all other resources are IN_SYNC.\n' +
      `Reason: ${driftStatus.DetectionStatusReason || 'No reason provided'}`,
    );
  }

  // Get the drift results, including resources with UNKNOWN status
  const driftResults = await cfn.describeStackResourceDrifts({
    StackName: stackName,
  });

  // Log warning for any resources with UNKNOWN status
  const unknownResources = driftResults.StackResourceDrifts?.filter(
    drift => drift.StackResourceDriftStatus === 'UNKNOWN',
  );

  if (unknownResources && unknownResources.length > 0) {
    await ioHelper.defaults.trace(
      'Some resources have UNKNOWN drift status. This may be due to insufficient permissions or throttling:\n' +
      unknownResources.map(r =>
        `  - ${r.LogicalResourceId}: ${r.DriftStatusReason || 'No reason provided'}`,
      ).join('\n'),
    );
  }

  return driftResults;
}

/**
 * Wait for a drift detection operation to complete
 */
async function waitForDriftDetection(
  cfn: ICloudFormationClient,
  ioHelper: IoHelper,
  driftDetectionId: string,
): Promise<DescribeStackDriftDetectionStatusCommandOutput | undefined> {
  const maxWaitForDrift = 300_000; // if takes longer than 5min, fail
  const timeBetweenOutputs = 10_000; // how long to wait before telling user we're still checking
  const timeBetweenApiCalls = 2_000; // wait 2s per API call
  const deadline = Date.now() + maxWaitForDrift;
  let checkIn = Date.now() + timeBetweenOutputs;

  while (true) {
    const response = await cfn.describeStackDriftDetectionStatus({
      StackDriftDetectionId: driftDetectionId,
    });

    if (response.DetectionStatus === 'DETECTION_COMPLETE') {
      return response;
    }

    if (response.DetectionStatus === 'DETECTION_FAILED') {
      throw new ToolkitError(`Drift detection failed: ${response.DetectionStatusReason || 'No reason provided'}`);
    }

    if (Date.now() > deadline) {
      throw new ToolkitError(`Drift detection failed: Timed out after ${maxWaitForDrift / 1000} seconds.`);
    }

    if (Date.now() > checkIn) {
      await ioHelper.defaults.trace('Waiting for drift detection to complete...');
      checkIn = Date.now() + timeBetweenOutputs;
    }

    // Wait a short while between API calls so we don't create a flood
    await new Promise(resolve => setTimeout(resolve, timeBetweenApiCalls));
  }
}
