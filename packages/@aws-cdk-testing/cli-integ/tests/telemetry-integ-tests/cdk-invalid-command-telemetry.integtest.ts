import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('no telemetry is collected if command is invalid', withDefaultFixture(async (fixture) => {
  const telemetryFile = path.join(fixture.integTestDir, `telemetry-${Date.now()}.json`);

  const commandOutput = await fixture.cdk(['invalid-command', `--telemetry-file=${telemetryFile}`], { verboseLevel: 3, allowErrExit: true }); // trace mode

  expect(commandOutput).toContain('Session instantiated with an invalid command');
  expect(fs.existsSync(telemetryFile)).toBeFalsy();
}),
);
