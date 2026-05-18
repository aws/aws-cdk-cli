import { PolicyViolationSeverity } from '../lib/cloud-assembly/validation-report-schema';

describe('PolicyViolationSeverity', () => {
  test('static members have expected names', () => {
    expect(PolicyViolationSeverity.ERROR.name).toBe('error');
    expect(PolicyViolationSeverity.WARNING.name).toBe('warning');
    expect(PolicyViolationSeverity.INFO.name).toBe('info');
  });

  test('custom creates a severity with the given name', () => {
    const severity = PolicyViolationSeverity.custom('compliance');
    expect(severity.name).toBe('compliance');
  });
});
