import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'IAM diff',
  withDefaultFixture(async (fixture) => {
    const output = await fixture.cdk(['diff', fixture.fullStackName('iam-test')]);

    // Roughly check for a table like this:
    //
    // ┌───┬─────────────────┬────────┬────────────────┬────────────────────────────-──┬───────────┐
    // │   │ Resource        │ Effect │ Action         │ Principal                     │ Condition │
    // ├───┼─────────────────┼────────┼────────────────┼───────────────────────────────┼───────────┤
    // │ + │ ${SomeRole.Arn} │ Allow  │ sts:AssumeRole │ Service:ec2.amazonaws.com     │           │
    // └───┴─────────────────┴────────┴────────────────┴───────────────────────────────┴───────────┘

    expect(output).toContain('${SomeRole.Arn}');
    expect(output).toContain('sts:AssumeRole');
    expect(output).toContain('ec2.amazonaws.com');
  }),
);

