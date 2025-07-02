import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'CLI Telemetry adds context value to cdk.context.json',
  withDefaultFixture(async (fixture) => {
    const contextFile = path.join(fixture.integTestDir, 'cdk.context.json');
    const context = {
      existedBefore: 'this was here',
    };
    await fs.writeFile(
      contextFile,
      JSON.stringify(context),
    );
    try {
      await fixture.cdk(['cli-telemetry', '--disable']);
      const newContext = JSON.parse((await fs.readFile(
        contextFile,
      )).toString());
      expect(newContext).toEqual({
        ...context,
        ['cli-telemetry']: false,
      });

      // Test that cli-telemetry enable works too
      await fixture.cdk(['cli-telemetry', '--enable']);
      const newerContext = JSON.parse((await fs.readFile(
        contextFile,
      )).toString());
      expect(newerContext).toEqual({
        ...context,
        ['cli-telemetry']: true,
      });

      // Test that cli-telemetry --no-enable works (equals --disable)
      await fixture.cdk(['cli-telemetry', '--no-enable']);
      const newestContext = JSON.parse((await fs.readFile(
        contextFile,
      )).toString());
      expect(newestContext).toEqual({
        ...context,
        ['cli-telemetry']: false,
      });
    } finally {
      await fs.unlink(path.join(fixture.integTestDir, 'cdk.context.json'));
    }
  }),
);
