import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(10 * 60 * 1000); // 10 minutes for watch tests

/**
 * Integration test for cdk watch with glob pattern support.
 *
 * This test verifies that the chokidar v4 glob pattern fix works correctly
 * by running `cdk watch` and verifying it detects file changes.
 */
integTest(
  'cdk watch detects file changes with glob patterns',
  withDefaultFixture(async (fixture) => {
    // Create a test file that will be watched
    const testFile = path.join(fixture.integTestDir, 'watch-test-file.ts');
    fs.writeFileSync(testFile, 'export const initial = true;');

    // Update cdk.json to include watch configuration
    const cdkJsonPath = path.join(fixture.integTestDir, 'cdk.json');
    const cdkJson = JSON.parse(fs.readFileSync(cdkJsonPath, 'utf-8'));
    cdkJson.watch = {
      include: ['**/*.ts', '**/*.js'],
      exclude: ['node_modules/**', 'cdk.out/**', '**/*.d.ts'],
    };
    fs.writeFileSync(cdkJsonPath, JSON.stringify(cdkJson, null, 2));

    // Make CLI available
    await fixture.cli.makeCliAvailable();

    // Accumulate output from the watch process
    let output = '';

    // Start cdk watch in the background using child_process directly
    const watchProcess = child_process.spawn('cdk', [
      'watch',
      '--hotswap',
      '-v',
      fixture.fullStackName('test-1'),
    ], {
      cwd: fixture.integTestDir,
      shell: true,
      env: {
        ...process.env,
        ...fixture.cdkShellEnv(),
      },
    });

    watchProcess.stdout?.on('data', (data) => {
      output += data.toString();
      fixture.log(data.toString());
    });

    watchProcess.stderr?.on('data', (data) => {
      output += data.toString();
      fixture.log(data.toString());
    });

    try {
      // Wait for the initial deployment to start
      await waitForOutput(() => output, "Triggering initial 'cdk deploy'", 120000);
      fixture.log('✓ Watch started and triggered initial deploy');

      // Wait for the initial deploy to complete (look for deployment success message)
      await waitForOutput(() => output, 'deployment time', 300000);
      fixture.log('✓ Initial deployment completed');

      // Modify the test file to trigger a watch event
      fs.writeFileSync(testFile, 'export const modified = true;');

      // Wait for the watch to detect the change
      await waitForOutput(() => output, 'Detected change to', 60000);
      fixture.log('✓ Watch detected file change');

      // Wait for the second deployment to complete
      // Count occurrences of 'deployment time' - need to see it twice
      await waitForCondition(
        () => (output.match(/deployment time/g) || []).length >= 2,
        60000,
        'second deployment to complete',
      );
      fixture.log('✓ Watch triggered deployment after file change');
    } finally {
      // Clean up: kill the watch process first and wait for it to fully terminate
      // before doing anything else to avoid conflicts
      watchProcess.kill('SIGTERM');

      // Wait for the process to actually exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          watchProcess.kill('SIGKILL');
          resolve();
        }, 10000);

        watchProcess.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      fixture.log('✓ Watch process terminated');

      // Wait additional time to ensure no lingering file handles
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Clean up test file (do this AFTER watch is fully stopped)
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }

      // Destroy the stack
      await fixture.cdkDestroy('test-1');
    }
  }),
);

/**
 * Wait for a specific output string in the accumulated output
 */
async function waitForOutput(getOutput: () => string, searchString: string, timeoutMs: number): Promise<void> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkOutput = () => {
      const currentOutput = getOutput();
      if (currentOutput.includes(searchString)) {
        resolve();
        return;
      }

      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for output: "${searchString}". Current output:\n${currentOutput.slice(-2000)}`));
        return;
      }

      setTimeout(checkOutput, 1000);
    };

    checkOutput();
  });
}

/**
 * Wait for a condition to become true
 */
async function waitForCondition(
  condition: () => boolean,
  timeoutMs: number,
  description: string,
): Promise<void> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }

      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for ${description}`));
        return;
      }

      setTimeout(check, 1000);
    };

    check();
  });
}
