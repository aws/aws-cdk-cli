import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000);

integTest(
  'cdk doctor displays diagnostic information',
  withDefaultFixture(async (fixture) => {
    const output = await fixture.cdk(['doctor']);
    expect(output).toContain('CDK Version');
    expect(output).toContain('AWS environment variables');
    expect(output).toContain('CDK environment variables');
  }),
);
