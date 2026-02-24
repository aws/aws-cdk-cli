import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { waitForOutput } from './watch-helpers';
import { integTest, withDefaultFixture, sleep } from '../../../lib';

jest.setTimeout(10 * 60 * 1000); // 10 minutes for watch tests

integTest(
  'cdk watch does NOT detect file changes for excluded patterns',
  withDefaultFixture(async (fixture) => {
    // Create a test file that will be watched (for initial deploy)
    const watchedFile = path.join(fixture.integTestDir, 'watched-file.ts');
    fs.writeFileSync(watchedFile, 'export const initial = true;');

    // Update cdk.json to include watch configuration with specific exclude
    const cdkJsonPath = path.join(fixture.integTestDir, 'cdk.json');
    const cdkJson = JSON.parse(fs.readFileSync(cdkJsonPath, 'utf-8'));
    cdkJson.watch = {
      include: ['**/*.ts'],
      exclude: ['**/*.excluded.ts'],
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

    // Count deployments before creating excluded file
    const deploymentsBefore = (output.match(/deployment time/g) || []).length;

    // Create an excluded file - this should NOT trigger a watch event
    const excludedFile = path.join(fixture.integTestDir, 'should-be-ignored.excluded.ts');
    fs.writeFileSync(excludedFile, 'export const excluded = true;');
    fixture.log('Created excluded file: should-be-ignored.excluded.ts');

    // Wait a reasonable time for any potential (unwanted) detection
    await sleep(5000);

    // Verify no "Detected change" message for the excluded file
    const detectedExcluded = output.includes('Detected change to') &&
    output.includes('excluded');

    if (detectedExcluded) {
      throw new Error('Watch should NOT have detected changes to excluded file');
    }

    // Verify deployment count hasn't increased
    const deploymentsAfter = (output.match(/deployment time/g) || []).length;
    if (deploymentsAfter > deploymentsBefore) {
      throw new Error(`Unexpected deployment triggered. Before: ${deploymentsBefore}, After: ${deploymentsAfter}`);
    }

    fixture.log('✓ Watch correctly ignored excluded file');

    // Now modify a watched file to confirm watch is still working
    fs.writeFileSync(watchedFile, 'export const modified = true;');

    await waitForOutput(() => output, 'Detected change to', 60000);
    fixture.log('✓ Watch still detects changes to included files');
  }),
);
