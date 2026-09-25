import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withSpecificFixture } from '../../lib';

integTest(
  'cdk validate records offlineWouldFailDeploy on the SYNTH telemetry event',
  withSpecificFixture('validate-app', async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, `telemetry-validate-${Date.now()}.json`);

    // --no-online keeps the run deterministic; offline validation still runs
    // during synthesis, and its deploy-blocking outcome is recorded on the
    // SYNTH event as offlineWouldFailDeploy (visible for synth/deploy/validate).
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', fixture.fullStackName('validate'), '--no-online', `--telemetry-file=${telemetryFile}`],
      {
        verboseLevel: 3, // trace mode
        allowErrExit: true, // violations make validate exit non-zero
      },
    );

    // The endpoint sink POSTs the whole event batch to the real telemetry
    // endpoint, which validates it against a request schema.
    expect(output).toContain('Telemetry Sent Successfully');

    const json = fs.readJSONSync(telemetryFile);
    const synthEvent = json.find((e: any) => e.event?.eventType === 'SYNTH');
    expect(synthEvent).toBeDefined();

    // The app's single S3 bucket makes SecurityPlugin report a fatal/error
    // violation, which is what would have failed a deploy.
    expect(synthEvent.counters).toEqual(
      expect.objectContaining({
        offlineWouldFailDeploy: 1,
      }),
    );

    fs.unlinkSync(telemetryFile);
  }),
);
