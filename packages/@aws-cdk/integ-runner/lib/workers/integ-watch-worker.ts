import type * as workerpool from 'workerpool';
import { printResults } from './common';
import type { IntegTestInfo } from '../runner';
import type { EngineOptions } from '../runner/engine';

export interface IntegWatchOptions extends IntegTestInfo, EngineOptions {
  readonly region: string;
  readonly profile?: string;
  readonly verbosity?: number;
}
export async function watchIntegrationTest(pool: workerpool.WorkerPool, options: IntegWatchOptions): Promise<void> {
  await pool.exec('watchTestWorker', [options], {
    on: printResults,
  });
}
