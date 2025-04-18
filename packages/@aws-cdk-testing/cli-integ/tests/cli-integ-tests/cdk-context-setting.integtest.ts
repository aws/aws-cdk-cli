import { promises as fs } from 'fs';
import * as path from 'path';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'context setting',
  withDefaultFixture(async (fixture) => {
    await fs.writeFile(
      path.join(fixture.integTestDir, 'cdk.context.json'),
      JSON.stringify({
        contextkey: 'this is the context value',
      }),
    );
    try {
      await expect(fixture.cdk(['context'])).resolves.toContain('this is the context value');

      // Test that deleting the contextkey works
      await fixture.cdk(['context', '--reset', 'contextkey']);
      await expect(fixture.cdk(['context'])).resolves.not.toContain('this is the context value');

      // Test that forced delete of the context key does not throw
      await fixture.cdk(['context', '-f', '--reset', 'contextkey']);
    } finally {
      await fs.unlink(path.join(fixture.integTestDir, 'cdk.context.json'));
    }
  }),
);

// bootstrapping also performs synthesis. As it turns out, bootstrap-stage synthesis still causes the lookups to be cached, meaning that the lookup never
// happens when we actually call `cdk synth --no-lookups`. This results in the error never being thrown, because it never tries to lookup anything.
// Fix this by not trying to bootstrap; there's no need to bootstrap anyway, since the test never tries to deploy anything.
