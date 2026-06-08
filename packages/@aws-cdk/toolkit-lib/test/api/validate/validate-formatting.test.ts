import * as chalk from 'chalk';
import type { ValidateResult } from '../../../lib/actions/validate';
import { formatValidateResult } from '../../../lib/api/validate/validate-formatting';

// Disable chalk for predictable assertions — set level directly because
// env vars may not take effect when chalk is already loaded by another test in the same worker.
(chalk as any).level = 0;

function makeResult(pluginReports: ValidateResult['pluginReports']): ValidateResult {
  const conclusion = pluginReports.some((r) => r.conclusion === 'failure') ? 'failure' : 'success';
  return { conclusion, pluginReports } as ValidateResult;
}

describe('formatValidateResult', () => {
  test('returns pass message when no violations', () => {
    const result = makeResult([
      { pluginName: 'TestPlugin', conclusion: 'success', violations: [] },
    ]);
    expect(formatValidateResult(result)).toContain('No problems found.');
  });

  test('sorts violations by severity (fatal > error > warning > info > custom)', () => {
    const result = makeResult([{
      pluginName: 'TestPlugin',
      conclusion: 'failure',
      violations: [
        { ruleName: 'r1', description: 'info issue', severity: 'info', violatingConstructs: [{ constructPath: 'Stack/A' }] },
        { ruleName: 'r2', description: 'fatal issue', severity: 'fatal', violatingConstructs: [{ constructPath: 'Stack/B' }] },
        { ruleName: 'r3', description: 'warning issue', severity: 'warning', violatingConstructs: [{ constructPath: 'Stack/C' }] },
        { ruleName: 'r4', description: 'error issue', severity: 'error', violatingConstructs: [{ constructPath: 'Stack/D' }] },
        { ruleName: 'r5', description: 'custom issue', severity: 'custom', violatingConstructs: [{ constructPath: 'Stack/E' }] },
      ],
    }]);

    const output = formatValidateResult(result);
    const lines = output.split('\n\n').filter(l => l.trim());
    expect(lines[1]).toContain('fatal issue');
    expect(lines[2]).toContain('error issue');
    expect(lines[3]).toContain('warning issue');
    expect(lines[4]).toContain('info issue');
    expect(lines[5]).toContain('custom issue');
  });

  test('formats construct path with logical id', () => {
    const result = makeResult([{
      pluginName: 'TestPlugin',
      conclusion: 'failure',
      violations: [{
        ruleName: 'rule1',
        description: 'bad thing',
        severity: 'error',
        violatingConstructs: [{
          constructPath: 'Stack/MyBucket/Resource',
          cloudFormationResource: { templatePath: 'Stack.template.json', logicalId: 'MyBucketF68F3FF0' },
        }],
      }],
    }]);

    const output = formatValidateResult(result);
    expect(output).toContain('Stack/MyBucket/Resource');
    expect(output).toContain('MyBucketF68F3FF0');
  });

  test('formats construct with only logical id when no construct path', () => {
    const result = makeResult([{
      pluginName: 'TestPlugin',
      conclusion: 'failure',
      violations: [{
        ruleName: 'rule1',
        description: 'bad thing',
        severity: 'error',
        violatingConstructs: [{
          constructPath: '',
          cloudFormationResource: { templatePath: 'Stack.template.json', logicalId: 'MyResource' },
        }],
      }],
    }]);

    const output = formatValidateResult(result);
    expect(output).toContain('MyResource');
  });

  test('extracts leaf location from stack trace with parens', () => {
    const result = makeResult([{
      pluginName: 'TestPlugin',
      conclusion: 'failure',
      violations: [{
        ruleName: 'rule1',
        description: 'bad',
        severity: 'error',
        violatingConstructs: [{
          constructPath: 'Stack/Bucket',
          stackTraces: ['new Bucket (lib/my-stack.ts:12:5)\nnew MyStack (lib/my-stack.ts:30:5)'],
        }],
      }],
    }]);

    const output = formatValidateResult(result);
    expect(output).toContain('lib/my-stack.ts:12:5');
  });

  test('extracts leaf location from bare stack trace without parens', () => {
    const result = makeResult([{
      pluginName: 'TestPlugin',
      conclusion: 'failure',
      violations: [{
        ruleName: 'rule1',
        description: 'bad',
        severity: 'error',
        violatingConstructs: [{
          constructPath: 'Stack/Bucket',
          stackTraces: ['at file.js:10:5'],
        }],
      }],
    }]);

    const output = formatValidateResult(result);
    expect(output).toContain('file.js:10:5');
  });

  test('omits acknowledge line for fatal severity', () => {
    const result = makeResult([{
      pluginName: 'TestPlugin',
      conclusion: 'failure',
      violations: [{
        ruleName: 'rule1',
        description: 'critical',
        severity: 'fatal',
        violatingConstructs: [{ constructPath: 'Stack/Resource' }],
      }],
    }]);

    const output = formatValidateResult(result);
    expect(output).not.toContain('Acknowledge');
  });

  test('includes acknowledge line for non-fatal severities', () => {
    const result = makeResult([{
      pluginName: 'SecurityPlugin',
      conclusion: 'failure',
      violations: [{
        ruleName: 'no-public-buckets',
        description: 'bad bucket',
        severity: 'error',
        violatingConstructs: [{ constructPath: 'Stack/Bucket' }],
      }],
    }]);

    const output = formatValidateResult(result);
    expect(output).toContain("Acknowledge 'SecurityPlugin::no-public-buckets'");
  });

  test('includes constructFqn when present', () => {
    const result = makeResult([{
      pluginName: 'TestPlugin',
      conclusion: 'failure',
      violations: [{
        ruleName: 'rule1',
        description: 'bad',
        severity: 'warning',
        violatingConstructs: [{
          constructPath: 'Stack/Bucket',
          constructFqn: 'aws-cdk-lib/aws-s3.Bucket',
        }],
      }],
    }]);

    const output = formatValidateResult(result);
    expect(output).toContain('aws-cdk-lib/aws-s3.Bucket');
  });

  test('sanitizes control characters from all taint sources', () => {
    const result = makeResult([{
      pluginName: 'Evil\x1b[2JPlugin',
      conclusion: 'failure',
      violations: [{
        ruleName: 'evil\x1b[0mrule',
        description: '\x1b[2K\rFake passed message',
        severity: 'error',
        violatingConstructs: [{
          constructPath: 'Stack/\x1b[31mRed',
          constructFqn: 'lib/\x07beep',
          cloudFormationResource: { templatePath: 'Stack.template.json', logicalId: '\x1b[0mFakeId' },
          stackTraces: ['at \x1b[2Jmalicious.ts:1:1'],
        }],
      }],
    }]);

    const output = formatValidateResult(result);
    expect(output).not.toMatch(/\x1b/);
    expect(output).not.toMatch(/\x07/);
    expect(output).not.toMatch(/\r/);
    expect(output).toContain('Fake passed message');
    expect(output).toContain('Evil');
  });
});
