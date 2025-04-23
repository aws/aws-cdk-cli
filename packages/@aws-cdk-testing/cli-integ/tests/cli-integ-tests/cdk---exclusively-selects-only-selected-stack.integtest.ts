import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  '--exclusively selects only selected stack',
  withDefaultFixture(async (fixture) => {
    // Deploy the "depends-on-failed" stack, with --exclusively. It will NOT fail (because
    // of --exclusively) and it WILL create an output we can check for to confirm that it did
    // get deployed.
    const outputsFile = path.join(fixture.integTestDir, 'outputs', 'outputs.json');
    await fs.mkdir(path.dirname(outputsFile), { recursive: true });

    await fixture.cdkDeploy('depends-on-failed-delete-me', {
      options: ['--exclusively', '--outputs-file', outputsFile],
    });

    // Verify the output to see that the stack deployed
    const outputs = JSON.parse((await fs.readFile(outputsFile, { encoding: 'utf-8' })).toString());
    expect(outputs).toEqual({
      [`${fixture.stackNamePrefix}-depends-on-failed`]: {
        TopicName: `${fixture.stackNamePrefix}-depends-on-failedMyTopic`,
      },
    });
  }),
);

