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
    const result = await toolkit.validate(cx, { online: false });

    expect(result.conclusion).toBe('failure');
    expect(result.title).toBe('Validation Report');
    expect(result.pluginReports).toHaveLength(2);
    expect(result.pluginReports[0].pluginName).toBe('TestPlugin');
    expect(result.pluginReports[0].conclusion).toBe('failure');
    expect(result.pluginReports[0].violations).toHaveLength(1);
    expect(result.pluginReports[0].violations[0].ruleName).toBe('no-public-buckets');
    expect(result.pluginReports[0].violations[0].violatingConstructs[0].constructPath).toBe('Stack1/MyBucket/Resource');
  });

  test('returns success when all plugins pass', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-passing-validation');
    const result = await toolkit.validate(cx, { online: false });

    expect(result.conclusion).toBe('success');
    expect(result.pluginReports).toHaveLength(1);
    expect(result.pluginReports[0].conclusion).toBe('success');
    expect(result.pluginReports[0].violations).toHaveLength(0);
  });

  test('returns success with no reports when no report file exists', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-bucket');
    const result = await toolkit.validate(cx, { online: false });

    expect(result.conclusion).toBe('success');
    expect(result.pluginReports).toHaveLength(0);
    ioHost.expectMessage({ containing: 'No validation plugins configured', level: 'info' });
  });

  test('emits info IO message on success', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-passing-validation');
    await toolkit.validate(cx, { online: false });

    ioHost.expectMessage({ containing: 'No problems found', level: 'info' });
  });

  test('can invoke without options', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-bucket');
    const result = await toolkit.validate(cx, { online: false });

    expect(result.conclusion).toBe('success');
  });

  test('passes stack selector to synthesis', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    const result = await toolkit.validate(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      online: false,
    });

    expect(result.conclusion).toBe('failure');
  });

  test('parses violation details correctly', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    const result = await toolkit.validate(cx, { online: false });

    const violation = result.pluginReports[0].violations[0];
    expect(violation.severity).toBe('error');
    expect(violation.suggestedFix).toBe('Set PublicAccessBlockConfiguration on the bucket');
    expect(violation.violatingConstructs).toHaveLength(1);
    expect(violation.violatingConstructs[0].cloudFormationResource?.logicalId).toBe('MyBucketF68F3FF0');
    expect(violation.violatingConstructs[0].cloudFormationResource?.templatePath).toBe('Stack1.template.json');
    expect(violation.violatingConstructs[0].cloudFormationResource?.propertyPaths).toEqual(['/Resources/MyBucketF68F3FF0']);
  });

  test('includes plugin version in report', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    const result = await toolkit.validate(cx, { online: false });

    expect(result.pluginReports[0].pluginVersion).toBe('1.0.0');
    expect(result.pluginReports[1].pluginVersion).toBeUndefined();
  });

  test('throws on malformed report', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-malformed-validation-report');

    await expect(toolkit.validate(cx, { online: false })).rejects.toThrow();
  });

  test('parses stack traces correctly', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    const result = await toolkit.validate(cx, { online: false });

    const construct = result.pluginReports[0].violations[0].violatingConstructs[0];
    expect(construct.stackTraces).toBeDefined();
    expect(construct.stackTraces![0]).toContain('new Bucket (lib/my-stack.ts:12:5)');
    expect(construct.stackTraces![0]).toContain('new MyStack (lib/my-stack.ts:30:5)');
  });

  test('IO message payload contains full ValidateResult', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-validation-report');
    await toolkit.validate(cx, { online: false });

    const msg = ioHost.messages.find(
      (m) => m.code === 'CDK_TOOLKIT_I9600',
    );
    expect(msg).toBeDefined();
    expect(msg!.data).toMatchObject({
      conclusion: 'failure',
      title: 'Validation Report',
      pluginReports: expect.arrayContaining([
        expect.objectContaining({
          pluginName: 'TestPlugin',
          conclusion: 'failure',
        }),
      ]),
    });
  });

  test('handles report with missing title field', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-no-title-validation');
    const result = await toolkit.validate(cx, { online: false });

    expect(result.conclusion).toBe('failure');
    expect(result.title).toBeUndefined();
    expect(result.pluginReports).toHaveLength(1);
    expect(result.pluginReports[0].violations[0].ruleName).toBe('no-public-buckets');
  });
});
