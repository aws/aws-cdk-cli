import { GetFunctionCommand } from '@aws-sdk/client-lambda';
import { sleep } from '../../../lib';

export async function waitForLambdaUpdateComplete(fixture: any, functionName: string): Promise<void> {
  const delaySeconds = 5;
  const timeout = 30_000; // timeout after 30s
  const deadline = Date.now() + timeout;

  while (true) {
    const response = await fixture.aws.lambda.send(
      new GetFunctionCommand({
        FunctionName: functionName,
      }),
    );

    const lastUpdateStatus = response.Configuration?.LastUpdateStatus;

    if (lastUpdateStatus === 'Successful') {
      return; // Update completed successfully
    }

    if (lastUpdateStatus === 'Failed') {
      throw new Error('Lambda function update failed');
    }

    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeout / 1000} seconds.`);
    }

    // Wait before checking again
    await sleep(delaySeconds * 1000);
  }
}
