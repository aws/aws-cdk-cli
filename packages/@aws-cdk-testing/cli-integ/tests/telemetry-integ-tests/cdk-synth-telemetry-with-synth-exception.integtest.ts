import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withSpecificFixture } from '../../lib';

integTest(
  'cdk synth with telemetry and validation error leads to invoke failure',
  withSpecificFixture('app-w-synthesis-error', async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, `telemetry-${Date.now()}.json`);
    const output = await fixture.cdk(['synth', `--telemetry-file=${telemetryFile}`], {
      allowErrExit: true,
      verboseLevel: 3, // trace mode
    });

    expect(output).toContain('This is an error');

    // Check the trace that telemetry was executed successfully despite error in synth
    expect(output).toContain('Telemetry Sent Successfully');

    const json = fs.readJSONSync(telemetryFile);
    expect(json).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          state: 'FAILED',
          eventType: 'SYNTH',
        }),
        error: {
          name: 'synth:InvalidBucketNameValue',
        },
      }),
    ]);
    fs.unlinkSync(telemetryFile);
  }, { aws: { disableBootstrap: true } }),
);

