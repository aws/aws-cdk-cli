import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'ssm parameter provider error',
  withDefaultFixture(async (fixture) => {
    await expect(
      fixture.cdk(
        ['synth', fixture.fullStackName('missing-ssm-parameter'), '-c', 'test:ssm-parameter-name=/does/not/exist'],
        {
          allowErrExit: true,
        },
      ),
    ).resolves.toContain('SSM parameter not available in account');
  }),
);

