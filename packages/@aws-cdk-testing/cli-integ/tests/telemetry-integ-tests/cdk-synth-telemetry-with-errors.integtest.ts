import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk synth with telemetry and validation error leads to invoke failure',
  withDefaultFixture(async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, `telemetry-${Date.now()}.json`);
    const output = await fixture.cdk(['synth', '--unstable=telemetry', `--telemetry-file=${telemetryFile}`], {
      allowErrExit: true,
      modEnv: {
        INTEG_STACK_SET: 'stage-with-errors',
      },
      verboseLevel: 3, // trace mode
    });

    expect(output).toContain('This is an error');

    // Check the trace that telemetry was executed successfully despite error in synth
    expect(output).toContain('Telemetry Sent Successfully');

    const json = fs.readJSONSync(telemetryFile);
    expect(json).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          command: expect.objectContaining({
            path: ['synth'],
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
              yes: false,
            }),
            config: {
              context: {},
            },
          }),
          state: 'SUCCEEDED',
          eventType: 'SYNTH',
        }),
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
            path: ['synth'],
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
              yes: false,
            }),
            config: {
              context: {},
            },
          }),
          state: 'FAILED',
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
        error: {
          name: 'AssemblyError',
        },
      }),
    ]);
    fs.unlinkSync(telemetryFile);
  }),
);

