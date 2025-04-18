import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'synth --quiet can be specified in cdk.json',
  withDefaultFixture(async (fixture) => {
    let cdkJson = JSON.parse(await fs.readFile(path.join(fixture.integTestDir, 'cdk.json'), 'utf8'));
    cdkJson = {
      ...cdkJson,
      quiet: true,
    };
    await fs.writeFile(path.join(fixture.integTestDir, 'cdk.json'), JSON.stringify(cdkJson));
    const synthOutput = await fixture.cdk(['synth', fixture.fullStackName('test-2')]);
    expect(synthOutput).not.toContain('topic152D84A37');
  }),
);

