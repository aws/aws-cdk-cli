import * as workerpool from 'workerpool';
import type { IntegTestInfo } from '../../lib/runner';
import { DiagnosticReason } from '../../lib/workers/common';
import type { IntegTestBatchRequest } from '../../lib/workers/integ-test-worker';

/**
 * Fixtures that simulate a WRONG_REGION report from the worker, keyed by a
 * marker in the test file name. The value is the set of regions the (fake)
 * freshly-synthesized app supports — the authoritative data the real worker
 * would discover after synth.
 *
 * - `wrong-region-stale`      supports us-east-2 (reschedulable when the pool has it)
 * - `wrong-region-unavailable` supports ap-northeast-3 (never in the test pools here)
 * - `wrong-region-disjoint`   supports nothing (disjoint test cases)
 */
const WRONG_REGION_SUPPORT: { [marker: string]: string[] } = {
  'wrong-region-stale': ['us-east-2'],
  'wrong-region-unavailable': ['ap-northeast-3'],
  'wrong-region-disjoint': [],
};

async function integTestWorker(request: IntegTestBatchRequest): Promise<IntegTestInfo[]> {
  const results: IntegTestInfo[] = [];
  for (const test of request.tests) {
    const marker = Object.keys(WRONG_REGION_SUPPORT).find((m) => test.fileName.includes(m));
    if (marker !== undefined) {
      const supportedRegions = WRONG_REGION_SUPPORT[marker];
      // Mirror the real worker: if the assigned region isn't supported by the
      // (fake) synthesized app, emit WRONG_REGION so the scheduler can react,
      // instead of recording a failure.
      if (!supportedRegions.includes(request.region)) {
        workerpool.workerEmit({
          reason: DiagnosticReason.WRONG_REGION,
          testName: test.fileName,
          message: `test does not support region ${request.region}`,
          supportedRegions,
          environment: { profile: request.profile, region: request.region },
        });
        continue;
      }
    }
    results.push(test);
  }
  return results;
}

workerpool.worker({
  integTestWorker,
});
