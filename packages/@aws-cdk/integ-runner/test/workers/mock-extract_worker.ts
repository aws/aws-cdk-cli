import * as workerpool from 'workerpool';
import type { IntegTestInfo } from '../../lib/runner';
import { DiagnosticReason } from '../../lib/workers/common';
import type { IntegTestBatchRequest } from '../../lib/workers/integ-test-worker';

async function integTestWorker(request: IntegTestBatchRequest): Promise<IntegTestInfo[]> {
  const results: IntegTestInfo[] = [];
  for (const test of request.tests) {
    // Simulate a test whose freshly-synthesized app only supports us-east-2,
    // regardless of where the scheduler (reading a possibly-stale snapshot)
    // placed it. Emit WRONG_REGION so the scheduler reschedules us, mirroring
    // what the real worker does when the assigned region is not supported.
    if (test.fileName.includes('wrong-region-stale') && request.region !== 'us-east-2') {
      workerpool.workerEmit({
        reason: DiagnosticReason.WRONG_REGION,
        testName: test.fileName,
        message: `test does not support region ${request.region}`,
        supportedRegions: ['us-east-2'],
        environment: { profile: request.profile, region: request.region },
      });
      continue;
    }
    results.push(test);
  }
  return results;
}

workerpool.worker({
  integTestWorker,
});
