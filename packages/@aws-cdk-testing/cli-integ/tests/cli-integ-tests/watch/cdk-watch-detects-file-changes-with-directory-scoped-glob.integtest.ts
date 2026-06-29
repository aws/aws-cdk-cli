import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { waitForOutput, waitForCondition, safeKillProcess } from './watch-helpers';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(5 * 60 * 1000); // 5 minutes for watch tests

// Regression test for https://github.com/aws/aws-cdk-cli/issues/1647:
// a user-supplied glob scoped to a subdirectory (e.g. 'src/**/*.ts') must
// detect changes to files nested inside that directory. The chokidar v4
// `ignored` callback also gates directory traversal, so an earlier bug pruned
// the 'src' directory (which does not itself match the file glob) before any
// nested file could be discovered - watch then silently observed nothing.
integTest(
  'cdk watch detects file changes with a directory-scoped glob pattern',
  withDefaultFixture(async (fixture) => {
    // Create a watched file nested inside a subdirectory, matched by 'src/**/*.ts'.
    const srcDir = path.join(fixture.integTestDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const testFile = path.join(srcDir, 'watch-test-file.ts');
    fs.writeFileSync(testFile, 'export const initial = true;');

    // Update cdk.json with a watch glob scoped to the 'src' directory.
    const cdkJsonPath = path.join(fixture.integTestDir, 'cdk.json');
    const cdkJson = JSON.parse(fs.readFileSync(cdkJsonPath, 'utf-8'));
    cdkJson.watch = {
      include: ['src/**/*.ts'],
    };
    fs.writeFileSync(cdkJsonPath, JSON.stringify(cdkJson, null, 2));

    await fixture.cli.makeCliAvailable();

    let output = '';

    // Start cdk watch
    const watchProcess = child_process.spawn('cdk', [
      'watch', '--hotswap', '-v', fixture.fullStackName('test-1'),
    ], {
      cwd: fixture.integTestDir,
      stdio: 'pipe',
      env: { ...process.env, ...fixture.cdkShellEnv() },
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

      await waitForOutput(() => output, "Triggering initial 'cdk deploy'");
      fixture.log('✓ Watch start detected');

      await waitForOutput(() => output, 'deployment time');
      fixture.log('✓ Initial deployment completed');

      // Modify the nested file to trigger a watch event. Before the fix the
      // 'src' directory was pruned, so this change was never detected.
      fs.writeFileSync(testFile, 'export const modified = true;');

      await waitForOutput(() => output, 'Detected change to');
      fixture.log('✓ Watch detected change to file nested under a directory-scoped glob');

      // Wait for the second deployment to complete (2 occurrences of 'deployment time')
      await waitForCondition(() => (output.match(/deployment time/g) || []).length >= 2);
      fixture.log('✓ Second deployment completed');
    } finally {
      safeKillProcess(watchProcess);
    }

    expect.assertions(4);
  }),
);
