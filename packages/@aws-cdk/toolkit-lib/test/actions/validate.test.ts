import { StackSelectionStrategy } from '../../lib/api/cloud-assembly';
import { Toolkit } from '../../lib/toolkit';
import { cdkOutFixture, TestIoHost } from '../_helpers';

let ioHost: TestIoHost;
let toolkit: Toolkit;

beforeEach(() => {
  ioHost = new TestIoHost();
  toolkit = new Toolkit({ ioHost });
});

describe('validate', () => {
  test('returns failure when report contains failing plugin', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    const result = await toolkit.validate(cx);

    expect(result.status).toBe('failure');
    expect(result.title).toBe('Validation Report');
    expect(result.pluginReports).toHaveLength(2);
    expect(result.pluginReports[0].summary.pluginName).toBe('TestPlugin');
    expect(result.pluginReports[0].summary.status).toBe('failure');
    expect(result.pluginReports[0].violations).toHaveLength(1);
    expect(result.pluginReports[0].violations[0].ruleName).toBe('no-public-buckets');
    expect(result.pluginReports[0].violations[0].violatingConstructs[0].constructPath).toBe('Stack1/MyBucket/Resource');
  });

  test('returns success when all plugins pass', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-passing-validation');
    const result = await toolkit.validate(cx);

    expect(result.status).toBe('success');
    expect(result.pluginReports).toHaveLength(1);
    expect(result.pluginReports[0].summary.status).toBe('success');
    expect(result.pluginReports[0].violations).toHaveLength(0);
  });

  test('returns success with no reports when no report file exists', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-bucket');
    const result = await toolkit.validate(cx);

    expect(result.status).toBe('success');
    expect(result.pluginReports).toHaveLength(0);
    ioHost.expectMessage({ containing: 'No policy validation report found', level: 'info' });
  });

  test('emits error IO message on failure', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    await toolkit.validate(cx);

    ioHost.expectMessage({ containing: 'Validation found policy violations', level: 'error' });
  });

  test('emits info IO message on success', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-passing-validation');
    await toolkit.validate(cx);

    ioHost.expectMessage({ containing: 'All policy checks passed', level: 'info' });
  });

  test('can invoke without options', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-bucket');
    const result = await toolkit.validate(cx);

    expect(result.status).toBe('success');
  });

  test('passes stack selector to synthesis', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    const result = await toolkit.validate(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    expect(result.status).toBe('failure');
  });

  test('parses violation details correctly', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    const result = await toolkit.validate(cx);

    const violation = result.pluginReports[0].violations[0];
    expect(violation.severity).toBe('error');
    expect(violation.fix).toBe('Set PublicAccessBlockConfiguration on the bucket');
    expect(violation.violatingResources).toHaveLength(1);
    expect(violation.violatingResources[0].resourceLogicalId).toBe('MyBucketF68F3FF0');
    expect(violation.violatingResources[0].templatePath).toBe('Stack1.template.json');
    expect(violation.violatingResources[0].locations).toEqual(['/Resources/MyBucketF68F3FF0']);
  });

  test('includes plugin version in report', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    const result = await toolkit.validate(cx);

    expect(result.pluginReports[0].version).toBe('1.0.0');
    expect(result.pluginReports[1].version).toBeUndefined();
  });

  test('throws on malformed report missing pluginReports', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-malformed-validation-report');

    await expect(toolkit.validate(cx)).rejects.toThrow(/malformed.*pluginReports/i);
  });

  test('parses constructStack trace correctly', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    const result = await toolkit.validate(cx);

    const construct = result.pluginReports[0].violations[0].violatingConstructs[0];
    expect(construct.constructStack).toBeDefined();
    expect(construct.constructStack!.id).toBe('App');
    expect(construct.constructStack!.child!.id).toBe('Stack1');
    expect(construct.constructStack!.child!.construct).toBe('aws-cdk-lib.Stack');
    expect(construct.constructStack!.child!.location).toBe('new MyStack (lib/my-stack.ts:30:5)');
    expect(construct.constructStack!.child!.child!.id).toBe('MyBucket');
    expect(construct.constructStack!.child!.child!.construct).toBe('aws-cdk-lib/aws-s3.Bucket');
    expect(construct.constructStack!.child!.child!.location).toBe('new Bucket (lib/my-stack.ts:12:5)');
  });

  test('IO message payload contains full ValidateResult', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    await toolkit.validate(cx);

    const errorMsg = ioHost.messages.find(
      (m) => m.code === 'CDK_TOOLKIT_E9600',
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.data).toMatchObject({
      status: 'failure',
      title: 'Validation Report',
      pluginReports: expect.arrayContaining([
        expect.objectContaining({
          summary: expect.objectContaining({ pluginName: 'TestPlugin', status: 'failure' }),
        }),
      ]),
    });
  });

  test('handles report with missing title field', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-no-title-validation');
    const result = await toolkit.validate(cx);

    expect(result.status).toBe('failure');
    expect(result.title).toBeUndefined();
    expect(result.pluginReports).toHaveLength(1);
    expect(result.pluginReports[0].violations[0].ruleName).toBe('no-public-buckets');
  });
});
