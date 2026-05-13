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

    ioHost.expectMessage({ containing: 'Policy validation failed', level: 'error' });
  });

  test('emits info IO message on success', async () => {
    const cx = await cdkOutFixture(toolkit, 'stack-with-passing-validation');
    await toolkit.validate(cx);

    ioHost.expectMessage({ containing: 'Policy validation passed', level: 'info' });
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
});
