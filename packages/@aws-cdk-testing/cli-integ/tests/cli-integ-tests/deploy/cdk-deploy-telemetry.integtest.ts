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
            path: ['deploy', '$STACK1'],
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
            path: ['deploy', '$STACK1'],
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
