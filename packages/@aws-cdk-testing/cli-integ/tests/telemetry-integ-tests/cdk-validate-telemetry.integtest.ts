import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withSpecificFixture } from '../../lib';

integTest(
  'cdk validate emits VALIDATE telemetry event with violation counters',
  withSpecificFixture('validate-app', async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, `telemetry-validate-${Date.now()}.json`);

    // --no-online keeps the run deterministic; onlineViolations is asserted to be 0.
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', fixture.fullStackName('validate'), '--no-online', `--telemetry-file=${telemetryFile}`],
      {
        verboseLevel: 3, // trace mode
        allowErrExit: true, // violations make validate exit non-zero
      },
    );

    // The endpoint sink POSTs the whole event batch to the real telemetry
    // endpoint, which validates it against a request schema. This passes only
    // once the backend accepts the VALIDATE event type.
    expect(output).toContain('Telemetry Sent Successfully');

    const json = fs.readJSONSync(telemetryFile);
    expect(json).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            state: 'SUCCEEDED',
            eventType: 'VALIDATE',
          }),
          // The app's single S3 bucket makes SecurityPlugin report one violation
          // each of fatal/error/warning/cost-optimization severity, plus one
          // construct annotation warning. The plugin failure is what would have
          // failed a deploy.
          counters: expect.objectContaining({
            'offlineViolations:fatal': 1,
            'offlineViolations:error': 1,
            'offlineViolations:warning': 2,
            'offlineViolations:cost-optimization': 1,
            'onlineViolations': 0,
            'offlineWouldFailDeploy': 1,
          }),
        }),
      ]),
    );

    fs.unlinkSync(telemetryFile);
  }),
);
