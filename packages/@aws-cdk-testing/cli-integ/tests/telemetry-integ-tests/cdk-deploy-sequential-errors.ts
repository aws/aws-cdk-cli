import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withSpecificFixture } from '../../lib';

integTest(
  'multiple deploys track their failures',
  withSpecificFixture('diagnose-app', async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, 'telemetry.json');

    // Deploy a stack that will fail (IAM Policy without PolicyDocument)
    await fixture.cdkDeploy('diagnose-deploy-fail', {
      allowErrExit: true,
      telemetryFile,
    });

    await fixture.cdkDeploy('diagnose-deploy-fail', {
      allowErrExit: true,
      telemetryFile,
    });

    // Should see a DEPLOY event with sequentialDeploymentFailures: 2
    const json = fs.readJSONSync(telemetryFile);
    expect(json).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: 'SYNTH',
        }),
      }),
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: 'ASSET',
        }),
      }),
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: 'DEPLOY',
        }),
        counters: expect.objectContaining({
          sequentialDeploymentFailures: 2,
        }),
      }),
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: 'INVOKE',
        }),
      }),
    ]);
  }),
);
