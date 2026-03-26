import { integTest, withAws, withSpecificCdkApp } from '../../../lib';

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
    { disableBootstrap: true },
  ),
);
