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
    const validateEvent = json.find((e: any) => e.event?.eventType === 'VALIDATE');
    expect(validateEvent).toBeDefined();
    expect(validateEvent.event.state).toEqual('SUCCEEDED');

    // The app's single S3 bucket makes SecurityPlugin report one violation each
    // of fatal/error/warning/cost-optimization severity, plus one construct
    // annotation warning. The plugin failure is what would have failed a deploy.
    expect(validateEvent.counters).toEqual(
      expect.objectContaining({
        'offlineViolations:fatal': 1,
        'offlineViolations:error': 1,
        'offlineViolations:warning': 2,
        'onlineViolations': 0,
        'offlineWouldFailDeploy': 1,
      }),
    );

    // The plugin's non-standard 'cost-optimization' severity is reported under
    // a library-version-dependent key ('offlineViolations:cost-optimization'
    // on older aws-cdk-lib, 'offlineViolations:custom' on newer), so assert
    // the total offline violation count instead of that key.
    const totalOfflineViolations = Object.entries(validateEvent.counters)
      .filter(([key]) => key.startsWith('offlineViolations:'))
      .reduce((acc, [, value]) => acc + Number(value), 0);
    expect(totalOfflineViolations).toEqual(5);

    fs.unlinkSync(telemetryFile);
  }),
);
