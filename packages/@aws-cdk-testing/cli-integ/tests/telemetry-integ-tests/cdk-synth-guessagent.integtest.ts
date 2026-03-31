import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withDefaultFixture } from '../../lib';

integTest(
  'cdk synth telemetry contains an agent guess',
  withDefaultFixture(async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, `telemetry-${Date.now()}.json`);

    const synthOutput = await fixture.cdk(
      ['synth', fixture.fullStackName('test-1'), `--telemetry-file=${telemetryFile}`],
      {
        verboseLevel: 3,
        modEnv: {
          AWS_EXECUTION_ENV: 'AmazonQ-For-CLI Version/1.23.1',
        },
      }, // trace mode
    );

    // Check the trace that telemetry was executed successfully
    expect(synthOutput).toContain('Telemetry Sent Successfully');

    const json = fs.readJSONSync(telemetryFile);
    expect(json).toEqual([
      expect.objectContaining({
        environment: expect.objectContaining({
          agent: true,
        }),
      }),
      expect.objectContaining({
        environment: expect.objectContaining({
          agent: true,
        }),
      }),
    ]);
    fs.unlinkSync(telemetryFile);
  }),
);
