import { integTest, withDefaultFixture } from '../../../lib';

integTest('cdk destroy with no force option exits without prompt if the stacks do not exist', withDefaultFixture(async (fixture) => {
  const nonExistingStackName1 = 'non-existing-stack-1';
  const nonExistingStackName2 = 'non-existing-stack-2';

  await expect(fixture.cdkDestroy([nonExistingStackName1, nonExistingStackName2], {
    force: false,
  })).resolves.not.toThrow();
}));
