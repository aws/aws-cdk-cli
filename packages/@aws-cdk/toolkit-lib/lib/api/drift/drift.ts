import { format } from 'util';
import type { DescribeStackDriftDetectionStatusCommandOutput, DescribeStackResourceDriftsCommandOutput } from '@aws-sdk/client-cloudformation';
import type { IDriftCloudFormationClient, IDriftIoHelper } from './interfaces';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { IO } from '../io/private';

/**
 * Detect drift for a CloudFormation stack and wait for the detection to complete
 *
 * @param cfn - a CloudFormation client
 * @param ioHelper - helper for IO operations
 * @param stackName - the name of the stack to check for drift
 * @returns the CloudFormation description of the drift detection results
 */
export async function detectStackDrift(
  cfn: IDriftCloudFormationClient,
  ioHelper: IDriftIoHelper,
  stackName: string,
): Promise<DescribeStackResourceDriftsCommandOutput> {
  await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(format('Starting drift detection for stack %s...', stackName)));

  // Start drift detection
  const driftDetection = await cfn.detectStackDrift({
    StackName: stackName,
  });

  await ioHelper.notify(IO.DEFAULT_TOOLKIT_INFO.msg(format('Detecting drift for stack %s...', stackName)));

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

  // Get the drift results
  return cfn.describeStackResourceDrifts({
    StackName: stackName,
  });
}

/**
 * Wait for a drift detection operation to complete
 */
async function waitForDriftDetection(
  cfn: IDriftCloudFormationClient,
  ioHelper: IDriftIoHelper,
  driftDetectionId: string,
): Promise<DescribeStackDriftDetectionStatusCommandOutput | undefined> {
  await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(format('Waiting for drift detection %s to complete...', driftDetectionId)));

  const timeout = 60_000; // if takes longer than 60s, fail
  const timeBetweenOutputs = 10_000; // how long to wait before telling user we're still checking
  const deadline = Date.now() + timeout;
  let checkIn = Date.now() + timeBetweenOutputs;

  while (true) {
    const response = await cfn.describeStackDriftDetectionStatus({
      StackDriftDetectionId: driftDetectionId,
    });

    if (response.DetectionStatus === 'DETECTION_COMPLETE') {
      return response;
    }

    if (response.DetectionStatus === 'DETECTION_FAILED') {
      throw new ToolkitError(`Drift detection failed: ${response.DetectionStatusReason}`);
    }

    if (Date.now() > deadline) {
      throw new ToolkitError(`Drift detection failed: Timed out after ${timeout / 1000} seconds.`);
    }

    if (Date.now() > checkIn) {
      await ioHelper.notify(IO.DEFAULT_TOOLKIT_INFO.msg('Waiting for drift detection to complete...'));
      checkIn = Date.now() + timeBetweenOutputs;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
