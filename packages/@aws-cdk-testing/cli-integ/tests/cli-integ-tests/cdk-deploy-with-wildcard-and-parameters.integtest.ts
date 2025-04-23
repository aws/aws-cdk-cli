import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy with wildcard and parameters',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('param-test-*', {
      options: [
        '--parameters',
        `${fixture.stackNamePrefix}-param-test-1:TopicNameParam=${fixture.stackNamePrefix}bazinga`,
        '--parameters',
        `${fixture.stackNamePrefix}-param-test-2:OtherTopicNameParam=${fixture.stackNamePrefix}ThatsMySpot`,
        '--parameters',
        `${fixture.stackNamePrefix}-param-test-3:DisplayNameParam=${fixture.stackNamePrefix}HeyThere`,
        '--parameters',
        `${fixture.stackNamePrefix}-param-test-3:OtherDisplayNameParam=${fixture.stackNamePrefix}AnotherOne`,
      ],
    });
  }),
);

