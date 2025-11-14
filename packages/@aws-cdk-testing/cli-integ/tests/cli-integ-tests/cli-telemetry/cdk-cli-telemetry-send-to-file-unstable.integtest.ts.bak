import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'sending cli telemetry to file fails if not invoked with --unstable',
  withDefaultFixture(async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, `telemetry-${Date.now()}.json`);
    try {
      await fixture.cdk(['list', `--telemetry-file=${telemetryFile}`]);
      throw new Error('Expected command to fail');
    } catch (error) {
      expect(fs.existsSync(telemetryFile)).toBeFalsy();
      expect(fixture.output.toString()).toContain('Unstable feature use');
    }
  }),
);
