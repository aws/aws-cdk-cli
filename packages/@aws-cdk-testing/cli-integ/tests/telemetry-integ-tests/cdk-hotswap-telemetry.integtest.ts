import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withDefaultFixture } from '../../lib';

integTest(
  'cdk hotswap deploy emits HOTSWAP telemetry event',
  withDefaultFixture(async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, `telemetry-hotswap-${Date.now()}.json`);

    // Initial deploy. DYNAMIC_LAMBDA_PROPERTY_VALUE is read by LambdaHotswapStack
    // in app.js to set the Lambda description and env vars — changing it between
    // deploys produces a hotswappable diff.
    await fixture.cdkDeploy('lambda-hotswap', {
      captureStderr: false,
      modEnv: { DYNAMIC_LAMBDA_PROPERTY_VALUE: 'original' },
    });

    // Hotswap deploy with telemetry
    const deployOutput = await fixture.cdkDeploy('lambda-hotswap', {
      options: ['--hotswap'],
      telemetryFile,
      verboseLevel: 3,
      modEnv: { DYNAMIC_LAMBDA_PROPERTY_VALUE: 'updated' },
    });

    // Check the trace that telemetry was executed successfully
    expect(deployOutput).toContain('Telemetry Sent Successfully');

    const json = fs.readJSONSync(telemetryFile);
    expect(json).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            state: 'SUCCEEDED',
            eventType: 'HOTSWAP',
          }),
        }),
      ]),
    );
    fs.unlinkSync(telemetryFile);
  }),
);
