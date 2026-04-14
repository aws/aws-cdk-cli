import {
  isChangeSetDeployment,
  isExecutingChangeSetDeployment,
  isNonExecutingChangeSetDeployment,
  toExecuteChangeSetDeployment,
} from '../../lib/actions/deploy/private/deployment-method';

describe('isChangeSetDeployment', () => {
  test('true for change-set method', () => {
    expect(isChangeSetDeployment({ method: 'change-set' })).toBe(true);
  });

  test('false for direct method', () => {
    expect(isChangeSetDeployment({ method: 'direct' })).toBe(false);
  });

  test('false for undefined', () => {
    expect(isChangeSetDeployment(undefined)).toBe(false);
  });
});

describe('isExecutingChangeSetDeployment', () => {
  test('true when execute is undefined (defaults to true)', () => {
    expect(isExecutingChangeSetDeployment({ method: 'change-set' })).toBe(true);
  });

  test('true when execute is true', () => {
    expect(isExecutingChangeSetDeployment({ method: 'change-set', execute: true })).toBe(true);
  });

  test('false when execute is false', () => {
    expect(isExecutingChangeSetDeployment({ method: 'change-set', execute: false })).toBe(false);
  });

  test('false for direct method', () => {
    expect(isExecutingChangeSetDeployment({ method: 'direct' })).toBe(false);
  });
});

describe('isNonExecutingChangeSetDeployment', () => {
  test('true when execute is false', () => {
    expect(isNonExecutingChangeSetDeployment({ method: 'change-set', execute: false })).toBe(true);
  });

  test('false when execute is undefined', () => {
    expect(isNonExecutingChangeSetDeployment({ method: 'change-set' })).toBe(false);
  });

  test('false when execute is true', () => {
    expect(isNonExecutingChangeSetDeployment({ method: 'change-set', execute: true })).toBe(false);
  });

  test('false for direct method', () => {
    expect(isNonExecutingChangeSetDeployment({ method: 'direct' })).toBe(false);
  });
});

describe('toExecuteChangeSetDeployment', () => {
  test('uses provided changeSetName', () => {
    const result = toExecuteChangeSetDeployment({ method: 'change-set', changeSetName: 'my-cs' });
    expect(result).toEqual({ method: 'execute-change-set', changeSetName: 'my-cs' });
  });

  test('defaults changeSetName to cdk-deploy-change-set', () => {
    const result = toExecuteChangeSetDeployment({ method: 'change-set' });
    expect(result).toEqual({ method: 'execute-change-set', changeSetName: 'cdk-deploy-change-set' });
  });
});
