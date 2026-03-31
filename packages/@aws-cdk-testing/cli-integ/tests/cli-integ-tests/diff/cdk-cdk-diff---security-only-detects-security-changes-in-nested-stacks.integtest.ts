import { integTest, withSpecificFixture } from '../../../lib';

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
    const lines = diff.split('\n');
    const noSecIdx = lines.findIndex(l => l.includes('NoSecurityNested'));
    expect(noSecIdx).toBeGreaterThanOrEqual(0);
    expect(lines[noSecIdx + 1]).toContain('There were no security-related changes');
  }),
);
