import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { Manifest } from '../lib/manifest';

describe('Manifest.loadValidationReport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-report-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('loads a valid report', () => {
    const reportPath = path.join(tmpDir, 'policy-validation-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      pluginReports: [{
        pluginName: 'TestPlugin',
        conclusion: 'failure',
        violations: [{
          ruleName: 'no-public-buckets',
          description: 'S3 Buckets must not be publicly accessible',
          severity: 'error',
          violatingConstructs: [{
            constructPath: 'MyStack/MyBucket/Resource',
            cloudFormationResource: {
              templatePath: 'MyStack.template.json',
              logicalId: 'MyBucketF68F3FF0',
            },
          }],
        }],
      }],
    }));

    const report = Manifest.loadValidationReport(reportPath);

    expect(report.pluginReports).toHaveLength(1);
    expect(report.pluginReports[0].pluginName).toBe('TestPlugin');
    expect(report.pluginReports[0].conclusion).toBe('failure');
    expect(report.pluginReports[0].violations[0].ruleName).toBe('no-public-buckets');
    expect(report.pluginReports[0].violations[0].violatingConstructs[0].constructPath).toBe('MyStack/MyBucket/Resource');
  });

  test('loads a report with optional fields', () => {
    const reportPath = path.join(tmpDir, 'policy-validation-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      title: 'Validation Report',
      pluginReports: [{
        pluginName: 'TestPlugin',
        pluginVersion: '1.0.0',
        conclusion: 'success',
        metadata: { environment: 'production' },
        violations: [],
      }],
    }));

    const report = Manifest.loadValidationReport(reportPath);

    expect(report.title).toBe('Validation Report');
    expect(report.pluginReports[0].pluginVersion).toBe('1.0.0');
    expect(report.pluginReports[0].metadata).toEqual({ environment: 'production' });
  });

  test('throws on missing required field pluginReports', () => {
    const reportPath = path.join(tmpDir, 'policy-validation-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      title: 'Validation Report',
    }));

    expect(() => Manifest.loadValidationReport(reportPath)).toThrow();
  });

  test('throws on invalid conclusion value', () => {
    const reportPath = path.join(tmpDir, 'policy-validation-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      pluginReports: [{
        pluginName: 'TestPlugin',
        conclusion: 'maybe',
        violations: [],
      }],
    }));

    expect(() => Manifest.loadValidationReport(reportPath)).toThrow();
  });

  test('throws on invalid severity value', () => {
    const reportPath = path.join(tmpDir, 'policy-validation-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      pluginReports: [{
        pluginName: 'TestPlugin',
        conclusion: 'failure',
        violations: [{
          ruleName: 'test-rule',
          description: 'test',
          severity: 'not-a-severity',
          violatingConstructs: [],
        }],
      }],
    }));

    expect(() => Manifest.loadValidationReport(reportPath)).toThrow();
  });
});
