import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'Two ways of showing the version',
  withDefaultFixture(async (fixture) => {
    const version1 = await fixture.cdk(['version'], { verbose: false });
    const version2 = await fixture.cdk(['--version'], { verbose: false });

    expect(version1).toEqual(version2);
  }),
);

