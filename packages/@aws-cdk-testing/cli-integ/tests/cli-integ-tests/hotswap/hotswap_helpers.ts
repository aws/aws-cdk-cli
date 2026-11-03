import * as path from 'path';
import type { TestFixture } from '../../../lib';

/**
 * Mirror of the CLI's on-disk hotswap cache path for a stack.
 *
 * The cache is keyed by the resolved target environment as well as the stack
 * name, so the same stack hotswapped into two accounts or regions from one
 * cloud assembly gets one cache file per environment.
 */
export async function hotswapCacheFile(fixture: TestFixture, stackName: string): Promise<string> {
  const environmentKey = `${await fixture.aws.account()}/${fixture.aws.region}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(
    fixture.integTestDir, 'cdk.out', '.hotswap-cache',
    `${fixture.fullStackName(stackName)}.${environmentKey}.json`,
  );
}
