import * as workerpool from 'workerpool';
import type { IntegTestInfo } from '../../lib/runner';
import type { IntegTestBatchRequest } from '../../lib/workers/integ-test-worker';

function integTestWorker(request: IntegTestBatchRequest): IntegTestInfo[] {
  return request.tests;
}

workerpool.worker({
  integTestWorker,
});

