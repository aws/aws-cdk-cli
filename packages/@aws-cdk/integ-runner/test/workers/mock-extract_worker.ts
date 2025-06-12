import * as workerpool from 'workerpool';
import type { IntegTestInfo } from '../../lib/runner';
import type { IntegTestBatchRequest } from '../../lib/workers/integ-test-worker';

async function integTestWorker(request: IntegTestBatchRequest): Promise<IntegTestInfo[]> {
  return request.tests;
}

workerpool.worker({
  integTestWorker,
});

