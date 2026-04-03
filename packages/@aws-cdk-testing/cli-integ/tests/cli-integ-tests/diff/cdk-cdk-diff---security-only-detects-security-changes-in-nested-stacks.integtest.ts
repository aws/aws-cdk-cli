import { integTest, withSpecificFixture } from '../../../lib';
import '../../../lib/assertions';

integTest(
  'cdk diff --security-only detects security changes in nested stacks',
  withSpecificFixture('nested-stack-with-iam', async (fixture) => {
    const stackName = fixture.fullStackName('nested-iam');

    const diff = await fixture.cdk(['diff', '--security-only', stackName]);

    // Two nested stacks have IAM roles
    expect(diff).toContain('sts:AssumeRole');
    expect(diff).toContain('lambda.amazonaws.com');
    expect(diff).toContain('Number of stacks with differences: 2');

    // The nested stack without security changes should say so on the next line
    expect(diff).toHaveNextLineMatching(/Stack NoSecurityNested\S+/, 'There were no security-related changes');
  }),
);
