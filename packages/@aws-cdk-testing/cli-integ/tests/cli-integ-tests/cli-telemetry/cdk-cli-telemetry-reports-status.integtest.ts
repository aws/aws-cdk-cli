import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'CLI Telemetry reports status',
  withDefaultFixture(async (fixture) => {
    const contextFile = path.join(fixture.integTestDir, 'cdk.context.json');
    const userContextFile = path.join(fixture.integTestDir, 'cdk.json');
    const context = {
      existedBefore: 'this was here',
    };
    await fs.writeFile(
      contextFile,
      JSON.stringify(context),
    );
    try {
      // default status is enabled
      const output1 = await fixture.cdk(['cli-telemetry', '--status']);
      expect(output1).toContain('Telemetry is enabled. Run \'cdk cli-telemetry --disable\' to disable.');

      // disable status
      await fs.writeFile(userContextFile, JSON.stringify({ context: { 'cli-telemetry': false } }));
      const output2 = await fixture.cdk(['cli-telemetry', '--status']);
      expect(output2).toContain('Telemetry is disabled. Run \'cdk cli-telemetry --enable\' to enable.');
    } finally {
      await fs.unlink(contextFile);
      await fs.unlink(userContextFile);
    }
  }),
);
