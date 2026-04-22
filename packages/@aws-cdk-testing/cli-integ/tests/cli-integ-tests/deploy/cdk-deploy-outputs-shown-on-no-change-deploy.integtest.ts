import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy outputs shown on initial and no-change deploys',
  withDefaultFixture(async (fixture) => {
    // First deploy — creates the stack
    const firstDeploy = await fixture.cdkDeploy('outputs-test-1');
    expect(firstDeploy).toContain('Outputs:');
    expect(firstDeploy).toContain('TopicName');

    // Second deploy — no changes, outputs must still be shown
    const secondDeploy = await fixture.cdkDeploy('outputs-test-1');
    expect(secondDeploy).toContain('Outputs:');
    expect(secondDeploy).toContain('TopicName');
    expect(secondDeploy).toContain('(no changes)');
  }),
);
