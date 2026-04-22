import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'outputs-file is written on initial and no-change deploys',
  withDefaultFixture(async (fixture) => {
    const outputsFile = path.join(fixture.integTestDir, 'outputs', 'outputs.json');
    await fs.mkdir(path.dirname(outputsFile), { recursive: true });

    // First deploy — creates the stack and writes the outputs file
    await fixture.cdkDeploy('outputs-test-1', { options: ['--outputs-file', outputsFile] });
    const firstOutputs = JSON.parse(await fs.readFile(outputsFile, 'utf-8'));
    expect(firstOutputs).toEqual({
      [`${fixture.stackNamePrefix}-outputs-test-1`]: {
        TopicName: `${fixture.stackNamePrefix}-outputs-test-1MyTopic`,
      },
    });

    // Delete the file so we can assert it gets recreated on the no-change deploy
    await fs.rm(outputsFile);

    // Second deploy — no changes, outputs file must still be written
    await fixture.cdkDeploy('outputs-test-1', { options: ['--outputs-file', outputsFile] });
    const secondOutputs = JSON.parse(await fs.readFile(outputsFile, 'utf-8'));
    expect(secondOutputs).toEqual(firstOutputs);
  }),
);
