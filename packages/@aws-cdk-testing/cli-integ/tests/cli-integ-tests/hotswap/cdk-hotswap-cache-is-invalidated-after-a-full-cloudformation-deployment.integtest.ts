import * as fs from 'fs';
import { hotswapCacheFile } from './hotswap_helpers';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(5 * 60 * 1000);

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
