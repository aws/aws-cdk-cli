import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy wildcard with outputs',
  withDefaultFixture(async (fixture) => {
    const outputsFile = path.join(fixture.integTestDir, 'outputs', 'outputs.json');
    await fs.mkdir(path.dirname(outputsFile), { recursive: true });

    await fixture.cdkDeploy(['outputs-test-*'], {
      options: ['--outputs-file', outputsFile],
    });

    const outputs = JSON.parse((await fs.readFile(outputsFile, { encoding: 'utf-8' })).toString());
    expect(outputs).toEqual({
      [`${fixture.stackNamePrefix}-outputs-test-1`]: {
        TopicName: `${fixture.stackNamePrefix}-outputs-test-1MyTopic`,
      },
      [`${fixture.stackNamePrefix}-outputs-test-2`]: {
        TopicName: `${fixture.stackNamePrefix}-outputs-test-2MyOtherTopic`,
      },
    });
  }),
);

