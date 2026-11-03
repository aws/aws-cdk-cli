import { integTest, withDefaultFixture } from '../../../lib';

integTest('cdk destroy does not fail even if the stages do not exist', withDefaultFixture(async (fixture) => {
  await expect(fixture.cdkDestroy('NonExistent/*')).resolves.not.toThrow();
}));
