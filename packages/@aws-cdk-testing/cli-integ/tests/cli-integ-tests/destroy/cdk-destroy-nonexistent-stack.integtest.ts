import { integTest, withDefaultFixture } from '../../../lib';

integTest('cdk destroy does not fail even if the stacks do not exist', withDefaultFixture(async (fixture) => {
  const nonExistingStackName1 = 'non-existing-stack-1';
  const nonExistingStackName2 = 'non-existing-stack-2';

  await expect(fixture.cdkDestroy([nonExistingStackName1, nonExistingStackName2])).resolves.not.toThrow();
}));
