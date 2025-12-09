import { integTest, withDefaultFixture } from '../../../lib';

integTest('cdk destroy does not fail even if the stacks do not exist', withDefaultFixture(async (fixture) => {
  const nonExistingStackName1 = 'non-existing-stack-1';
  const nonExistingStackName2 = 'non-existing-stack-2';

  await expect(fixture.cdkDestroy([nonExistingStackName1, nonExistingStackName2])).resolves.not.toThrow();
}));

integTest('cdk destroy with no force option exits without prompt if the stacks do not exist', withDefaultFixture(async (fixture) => {
  const nonExistingStackName1 = 'non-existing-stack-1';
  const nonExistingStackName2 = 'non-existing-stack-2';

  await expect(fixture.cdk(['destroy', ...fixture.fullStackName([nonExistingStackName1, nonExistingStackName2])])).resolves.not.toThrow();
}));

integTest('cdk destroy does not fail with wildcard pattern that matches no stacks', withDefaultFixture(async (fixture) => {
  await expect(fixture.cdkDestroy('NonExistent*')).resolves.not.toThrow();
}));

integTest('cdk destroy does not fail with --all when no stacks exist', withDefaultFixture(async (fixture) => {
  await expect(fixture.cdkDestroy('--all')).resolves.not.toThrow();
}));
