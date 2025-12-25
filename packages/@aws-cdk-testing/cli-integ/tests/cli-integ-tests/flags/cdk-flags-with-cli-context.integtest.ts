import { integTest, withAws, withSpecificCdkApp } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'flags command works with CLI context parameters',
  withAws(
    withSpecificCdkApp('context-app', async (fixture) => {
      await fixture.cdk(['bootstrap', '-c', 'myContextParam=testValue']);

      const output = await fixture.cdk([
        'flags',
        '--unstable=flags',
        '--set',
        '--recommended',
        '--all',
        '-c', 'myContextParam=testValue',
        '--yes',
      ]);

      expect(output).toContain('Flag changes:');
    }),
    true,
  ),
);
