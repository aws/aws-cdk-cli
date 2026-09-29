import * as fs from 'fs';
import * as path from 'path';
import type { TestFixture } from '../../../lib';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(5 * 60 * 1000);

/**
 * Mirror of the CLI's on-disk hotswap cache path for a stack.
 *
 * The cache is keyed by the resolved target environment as well as the stack
 * name, so the same stack hotswapped into two accounts or regions from one
 * cloud assembly gets one cache file per environment.
 */
async function hotswapCacheFile(fixture: TestFixture, stackName: string): Promise<string> {
  const environmentKey = `${await fixture.aws.account()}/${fixture.aws.region}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(
    fixture.integTestDir, 'cdk.out', '.hotswap-cache',
    `${fixture.fullStackName(stackName)}.${environmentKey}.json`,
  );
}

integTest(
  'hotswap deployment caches template and uses it for subsequent hotswaps',
  withDefaultFixture(async (fixture) => {
    const stackName = 'cc-hotswap';

    // GIVEN - initial full deploy
    await fixture.cdkDeploy(stackName, {
      captureStderr: false,
      modEnv: {
        DYNAMIC_CC_PROPERTY_VALUE: 'v1',
        DYNAMIC_CC_PROPERTY_VALUE_2: 'v1',
      },
    });

    // WHEN - first hotswap changes ALL resources, creates the cache
    await fixture.cdkDeploy(stackName, {
      options: ['--hotswap'],
      captureStderr: false,
      modEnv: {
        DYNAMIC_CC_PROPERTY_VALUE: 'v2',
        DYNAMIC_CC_PROPERTY_VALUE_2: 'v2',
      },
    });

    const fullStackName = fixture.fullStackName(stackName);
    const cacheFile = await hotswapCacheFile(fixture, stackName);
    expect(fs.existsSync(cacheFile)).toBe(true);

    // the cache must be scoped to the target environment - the environment-agnostic
    // path it used to be written to would be served to any account/region
    const legacyCacheFile = path.join(fixture.integTestDir, 'cdk.out', '.hotswap-cache', `${fullStackName}.json`);
    expect(fs.existsSync(legacyCacheFile)).toBe(false);

    // THEN - second hotswap changes only the Dashboard (via DYNAMIC_CC_PROPERTY_VALUE_2).
    // If the cache is used, the diff is against the cached template, only 1 resource should be hotswapped.
    const deployOutput = await fixture.cdkDeploy(stackName, {
      options: ['--hotswap'],
      captureStderr: true,
      onlyStderr: true,
      modEnv: {
        DYNAMIC_CC_PROPERTY_VALUE: 'v2', // unchanged from first hotswap
        DYNAMIC_CC_PROPERTY_VALUE_2: 'v3',
      },
    });

    // should only see one hotswapped message in output
    const hotswapCount = (deployOutput.match(/hotswapped!/g) || []).length;
    expect(hotswapCount).toBe(1);
  }),
);

integTest(
  'hotswap cache is invalidated after a full CloudFormation deployment',
  withDefaultFixture(async (fixture) => {
    // GIVEN - deploy then hotswap to create cache
    await fixture.cdkDeploy('lambda-hotswap', {
      captureStderr: false,
      modEnv: {
        DYNAMIC_LAMBDA_PROPERTY_VALUE: 'v1',
      },
    });

    await fixture.cdkDeploy('lambda-hotswap', {
      options: ['--hotswap'],
      captureStderr: false,
      modEnv: {
        DYNAMIC_LAMBDA_PROPERTY_VALUE: 'v2',
      },
    });

    const cacheFile = await hotswapCacheFile(fixture, 'lambda-hotswap');
    expect(fs.existsSync(cacheFile)).toBe(true);

    // WHEN - full CFN deploy
    await fixture.cdkDeploy('lambda-hotswap', {
      captureStderr: false,
      modEnv: {
        DYNAMIC_LAMBDA_PROPERTY_VALUE: 'v3',
      },
    });

    // THEN - cache should be invalidated
    expect(fs.existsSync(cacheFile)).toBe(false);
  }),
);
