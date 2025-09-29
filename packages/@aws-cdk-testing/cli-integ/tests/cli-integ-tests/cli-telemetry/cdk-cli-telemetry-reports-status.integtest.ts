import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'CLI Telemetry reports status',
  withDefaultFixture(async (fixture) => {
    const userContextFile = path.join(fixture.integTestDir, 'cdk.json');
    try {
      // default status is enabled
      const output1 = await fixture.cdk(['cli-telemetry', '--status']);
      expect(output1).toContain('CLI Telemetry is enabled. See https://github.com/aws/aws-cdk-cli/tree/main/packages/aws-cdk#cdk-cli-telemetry for ways to disable.');

      // disable status
      await fs.writeFile(userContextFile, JSON.stringify({ context: { 'cli-telemetry': false } }));
      const output2 = await fixture.cdk(['cli-telemetry', '--status']);
      expect(output2).toContain('CLI Telemetry is disabled. See https://github.com/aws/aws-cdk-cli/tree/main/packages/aws-cdk#cdk-cli-telemetry for ways to enable.');
    } finally {
      await fs.unlink(userContextFile);
    }
  }),
);
