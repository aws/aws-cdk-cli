import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { waitForOutput } from './watch-helpers';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(10 * 60 * 1000); // 10 minutes for watch tests

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
      include: ['**/*.ts'],
    };
    fs.writeFileSync(cdkJsonPath, JSON.stringify(cdkJson, null, 2));

    await fixture.cli.makeCliAvailable();

    let output = '';

    // Start cdk watch with detached process group for clean termination
    const watchProcess = child_process.spawn('cdk', [
      'watch', '--hotswap', '-v', fixture.fullStackName('test-1'),
    ], {
      cwd: fixture.integTestDir,
      shell: true,
      detached: true,
      env: { ...process.env, ...fixture.cdkShellEnv() },
    });

    watchProcess.stdout?.on('data', (data) => {
      output += data.toString();
      fixture.log(data.toString());
    });
    watchProcess.stderr?.on('data', (data) => {
      output += data.toString();
      fixture.log(data.toString());
    });

    await waitForOutput(() => output, "Triggering initial 'cdk deploy'", 120000);
    fixture.log('✓ Watch started');

    await waitForOutput(() => output, 'deployment time', 300000);
    fixture.log('✓ Initial deployment completed');

    // Modify the test file to trigger a watch event
    fs.writeFileSync(testFile, 'export const modified = true;');

    await waitForOutput(() => output, 'Detected change to', 60000);
    fixture.log('✓ Watch detected file change');
  }),
);
