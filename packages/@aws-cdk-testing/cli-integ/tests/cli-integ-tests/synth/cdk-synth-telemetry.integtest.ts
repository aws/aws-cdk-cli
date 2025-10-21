import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk synth with telemetry data',
  withDefaultFixture(async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, `telemetry-${Date.now()}.json`);

    const synthOutput = await fixture.cdk(
      ['synth', fixture.fullStackName('test-1'), '--unstable=telemetry', `--telemetry-file=${telemetryFile}`],
      { options: ['-vvv'] }, // force trace mode
    );

    // Check the trace that telemetry was executed successfully
    expect(synthOutput).toContain('Telemetry Sent Successfully');

    const json = fs.readJSONSync(telemetryFile);
    expect(json).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          command: expect.objectContaining({
            path: ['synth', '$STACKS_1'],
            parameters: expect.objectContaining({
              unstable: '<redacted>',
              ['telemetry-file']: '<redacted>',
              lookups: true,
              ['ignore-errors']: false,
              json: false,
              debug: false,
              staging: true,
              ['no-color']: false,
              ci: expect.anything(), // changes based on where this is called
              validation: true,
              quiet: false,
            }),
            config: {
              context: {},
            },
          }),
          state: 'SUCCEEDED',
          eventType: 'SYNTH',
        }),
        // some of these can change; but we assert that some value is recorded
        identifiers: expect.objectContaining({
          installationId: expect.anything(),
          sessionId: expect.anything(),
          telemetryVersion: '1.0',
          cdkCliVersion: expect.anything(),
          cdkLibraryVersion: fixture.library.requestedVersion(),
          region: expect.anything(),
          eventId: expect.stringContaining(':1'),
          timestamp: expect.anything(),
        }),
        environment: {
          ci: expect.anything(),
          os: {
            platform: expect.anything(),
            release: expect.anything(),
          },
          nodeVersion: expect.anything(),
        },
        project: {},
        duration: {
          total: expect.anything(),
        },
      }),
      expect.objectContaining({
        event: expect.objectContaining({
          command: expect.objectContaining({
            path: ['synth', '$STACKS_1'],
            parameters: expect.objectContaining({
              unstable: '<redacted>',
              ['telemetry-file']: '<redacted>',
              lookups: true,
              ['ignore-errors']: false,
              json: false,
              debug: false,
              staging: true,
              ['no-color']: false,
              ci: expect.anything(), // changes based on where this is called
              validation: true,
              quiet: false,
            }),
            config: {
              context: {},
            },
          }),
          state: 'SUCCEEDED',
          eventType: 'INVOKE',
        }),
        identifiers: expect.objectContaining({
          installationId: expect.anything(),
          sessionId: expect.anything(),
          telemetryVersion: '1.0',
          cdkCliVersion: expect.anything(),
          cdkLibraryVersion: fixture.library.requestedVersion(),
          region: expect.anything(),
          eventId: expect.stringContaining(':2'),
          timestamp: expect.anything(),
        }),
        environment: {
          ci: expect.anything(),
          os: {
            platform: expect.anything(),
            release: expect.anything(),
          },
          nodeVersion: expect.anything(),
        },
        project: {},
        duration: {
          total: expect.anything(),
        },
      }),
    ]);
    fs.unlinkSync(telemetryFile);
  }),
);
