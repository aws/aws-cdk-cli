import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk deploy with telemetry data',
  withDefaultFixture(async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, 'telemetry.json');

    // Deploy stack while collecting telemetry
    const deployOutput = await fixture.cdkDeploy('test-1', {
      telemetryFile,
      options: ['-vvv'], // force trace mode
    });

    // Check the trace that telemetry was executed successfully
    expect(deployOutput).toContain('Telemetry Sent Successfully');

    const json = fs.readJSONSync(telemetryFile);
    expect(json).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          command: expect.objectContaining({
            path: ['deploy', '$STACKS_1'],
          }),
          state: 'SUCCEEDED',
          eventType: 'SYNTH',
        }),
        identifiers: expect.objectContaining({
          eventId: expect.stringContaining(':1'),
        }),
      }),
      expect.objectContaining({
        event: expect.objectContaining({
          command: expect.objectContaining({
            path: ['deploy', '$STACKS_1'],
          }),
          state: 'SUCCEEDED',
          eventType: 'DEPLOY',
        }),
        identifiers: expect.objectContaining({
          eventId: expect.stringContaining(':2'),
        }),
      }),
      expect.objectContaining({
        event: expect.objectContaining({
          command: expect.objectContaining({
            path: ['deploy', '$STACKS_1'],
          }),
          state: 'SUCCEEDED',
          eventType: 'INVOKE',
        }),
        identifiers: expect.objectContaining({
          eventId: expect.stringContaining(':3'),
        }),
      }),
    ]);
    fs.unlinkSync(telemetryFile);
  }),
);
