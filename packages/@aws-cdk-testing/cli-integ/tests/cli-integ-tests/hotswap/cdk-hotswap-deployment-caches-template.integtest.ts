import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { waitForOutput, waitForCondition, safeKillProcess } from '../watch/watch-helpers';
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
    const cacheFile = path.join(fixture.integTestDir, 'cdk.out', '.hotswap-cache', `${fullStackName}.json`);
    expect(fs.existsSync(cacheFile)).toBe(true);

    // THEN - second hotswap changes only the Agent (via DYNAMIC_CC_PROPERTY_VALUE_2).
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

    const stackName = fixture.fullStackName('lambda-hotswap');
    const cacheFile = path.join(fixture.integTestDir, 'cdk.out', '.hotswap-cache', `${stackName}.json`);
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

integTest(
  'cdk watch creates and reuses hotswap cache across file changes',
  withDefaultFixture(async (fixture) => {
    // GIVEN - initial full deploy so the stack exists
    await fixture.cdkDeploy('lambda-hotswap', {
      captureStderr: false,
      modEnv: {
        DYNAMIC_LAMBDA_PROPERTY_VALUE: 'watch-test',
      },
    });

    const stackName = fixture.fullStackName('lambda-hotswap');
    const cacheFile = path.join(fixture.integTestDir, 'cdk.out', '.hotswap-cache', `${stackName}.json`);

    // Set up watch config
    const cdkJsonPath = path.join(fixture.integTestDir, 'cdk.json');
    const cdkJson = JSON.parse(fs.readFileSync(cdkJsonPath, 'utf-8'));
    cdkJson.watch = { include: ['**/*.js'] };
    fs.writeFileSync(cdkJsonPath, JSON.stringify(cdkJson, null, 2));

    await fixture.cli.makeCliAvailable();

    let output = '';
    const watchProcess = child_process.spawn('cdk', [
      'watch', '--hotswap', '-v', fixture.fullStackName('lambda-hotswap'),
    ], {
      cwd: fixture.integTestDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        ...fixture.cdkShellEnv(),
        DYNAMIC_LAMBDA_PROPERTY_VALUE: 'watch-test',
      },
    });

    try {
      watchProcess.stdout?.on('data', (data) => {
        output += data.toString();
        fixture.log(data.toString());
      });
      watchProcess.stderr?.on('data', (data) => {
        output += data.toString();
        fixture.log(data.toString());
      });

      // Wait for initial watch deploy to complete
      await waitForOutput(() => output, 'deployment time');
      fixture.log('✓ Initial watch deployment completed');

      // Cache should exist after first hotswap
      expect(fs.existsSync(cacheFile)).toBe(true);
      const cacheAfterFirst = fs.readFileSync(cacheFile, 'utf-8');

      // Modify Lambda source to trigger a second hotswap via watch
      const lambdaFile = path.join(fixture.integTestDir, 'lambda', 'index.js');
      fs.appendFileSync(lambdaFile, '\n// trigger hotswap');

      // Wait for watch to detect change and complete second deployment
      await waitForCondition(() => (output.match(/deployment time/g) || []).length >= 2);
      fixture.log('✓ Second watch deployment completed');

      // Cache should still exist and be updated
      expect(fs.existsSync(cacheFile)).toBe(true);
      const cacheAfterSecond = fs.readFileSync(cacheFile, 'utf-8');
      expect(cacheAfterSecond).not.toEqual(cacheAfterFirst);
    } finally {
      safeKillProcess(watchProcess);
    }
  }),
);
