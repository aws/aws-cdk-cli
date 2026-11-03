import * as fs from 'fs';
import * as path from 'path';
import { hotswapCacheFile } from './hotswap_helpers';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(5 * 60 * 1000);

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
