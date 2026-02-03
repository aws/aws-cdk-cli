import * as workerpool from 'workerpool';
import type { IntegTestWorkerResponse } from '../../lib/workers/extract/extract_worker';
import type { IntegTestBatchRequest } from '../../lib/workers/integ-test-worker';

async function integTestWorker(request: IntegTestBatchRequest): Promise<IntegTestWorkerResponse> {
  return {
    failedTests: request.tests,
    retryableFailures: undefined,
    environmentRemovals: undefined,
  };
}

workerpool.worker({
  integTestWorker,
});

