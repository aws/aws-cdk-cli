import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk deploy with telemetry data',
  withDefaultFixture(async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, 'telemetry.json');

    // Deploy stack while collecting telemetry
    await fixture.cdkDeploy('test-1', {
      telemetryFile,
    });
    const json = fs.readJSONSync(telemetryFile);
    expect(json).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          command: expect.objectContaining({
            path: ['deploy', '$STACK1'],
            parameters: expect.objectContaining({
              all: false,
              ['asset-prebuild']: true,
              ['build-exclude']: '<redacted>',
              ci: expect.anything(), // changes based on where this is called
              concurrency: 1,
              debug: false,
              force: false,
              ['ignore-errors']: false,
              ['ignore-no-stacks']: false,
              ['import-existing-resources']: false,
              json: false,
              logs: true,
              lookups: true,
              ['no-color']: false,
              notices: true,
              parameters: '<redacted>',
              ['previous-parameters']: true,
              progress: '<redacted>',
              ['require-approval']: '<redacted>',
              staging: true,
              ['telemetry-file']: '<redacted>',
              unstable: '<redacted>',
              verbose: 1,
            }),
            config: {
              bags: true,
              fileNames: true,
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
            path: ['deploy', '$STACK1'],
            parameters: expect.objectContaining({
              all: false,
              ['asset-prebuild']: true,
              ['build-exclude']: '<redacted>',
              ci: expect.anything(), // changes based on where this is called
              concurrency: 1,
              debug: false,
              force: false,
              ['ignore-errors']: false,
              ['ignore-no-stacks']: false,
              ['import-existing-resources']: false,
              json: false,
              logs: true,
              lookups: true,
              ['no-color']: false,
              notices: true,
              parameters: '<redacted>',
              ['previous-parameters']: true,
              progress: '<redacted>',
              ['require-approval']: '<redacted>',
              staging: true,
              ['telemetry-file']: '<redacted>',
              unstable: '<redacted>',
              verbose: 1,
            }),
            config: {
              bags: true,
              fileNames: true,
            },
          }),
          state: 'SUCCEEDED',
          eventType: 'DEPLOY',
        }),
        identifiers: expect.objectContaining({
          installationId: expect.anything(),
          sessionId: expect.anything(),
          telemetryVersion: '1.0',
          cdkCliVersion: expect.anything(),
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
      expect.objectContaining({
        event: expect.objectContaining({
          command: expect.objectContaining({
            path: ['deploy', '$STACK1'],
            parameters: expect.objectContaining({
              all: false,
              ['asset-prebuild']: true,
              ['build-exclude']: '<redacted>',
              ci: expect.anything(), // changes based on where this is called
              concurrency: 1,
              debug: false,
              force: false,
              ['ignore-errors']: false,
              ['ignore-no-stacks']: false,
              ['import-existing-resources']: false,
              json: false,
              logs: true,
              lookups: true,
              ['no-color']: false,
              notices: true,
              parameters: '<redacted>',
              ['previous-parameters']: true,
              progress: '<redacted>',
              ['require-approval']: '<redacted>',
              staging: true,
              ['telemetry-file']: '<redacted>',
              unstable: '<redacted>',
              verbose: 1,
            }),
            config: {
              bags: true,
              fileNames: true,
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
          region: expect.anything(),
          eventId: expect.stringContaining(':3'),
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
