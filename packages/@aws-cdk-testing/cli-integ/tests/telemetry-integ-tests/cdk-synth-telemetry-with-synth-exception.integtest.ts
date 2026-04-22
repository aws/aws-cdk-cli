import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withSpecificFixture } from '../../lib';

integTest(
  'cdk synth with telemetry and validation error leads to invoke failure',
  withSpecificFixture('app-w-synthesis-error', async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, `telemetry-${Date.now()}.json`);
    await fixture.cdk(['synth', `--telemetry-file=${telemetryFile}`], {
      allowErrExit: true,
      verboseLevel: 3, // trace mode
    });

    const json = fs.readJSONSync(telemetryFile);
    expect(json).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: 'SYNTH',
          state: 'FAILED',
        }),
        error: {
          name: 'synth:InvalidBucketNameValue',
        },
      }),
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: 'INVOKE',
          state: 'FAILED',
        }),
        error: {
          name: 'synth:InvalidBucketNameValue',
        },
      }),
    ]);
    fs.unlinkSync(telemetryFile);
  }, { aws: { disableBootstrap: true } }),
);

