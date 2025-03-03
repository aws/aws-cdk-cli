import { validateSnsTopicArn, stackEventHasErrorMessage, maxResourceTypeLength } from '../../src/util/cloudformation';

describe('validateSnsTopicArn', () => {
  test('empty string', () => {
    const arn = '';
    expect(validateSnsTopicArn(arn)).toEqual(false);
  });

  test('colon in topic name', () => {
    const arn = 'arn:aws:sns:eu-west-1:abc:foo';
    expect(validateSnsTopicArn(arn)).toEqual(false);
  });

  test('missing :aws: in arn', () => {
    const arn = 'arn:sns:eu-west-1:foobar';
    expect(validateSnsTopicArn(arn)).toEqual(false);
  });

  test('dash in topic name', () => {
    const arn = 'arn:aws:sns:eu-west-1:123456789876:foo-bar';
    expect(validateSnsTopicArn(arn)).toEqual(true);
  });

  test('underscore in topic name', () => {
    const arn = 'arn:aws:sns:eu-west-1:123456789876:foo-bar_baz';
    expect(validateSnsTopicArn(arn)).toEqual(true);
  });
});

describe('stackEventHasErrorMessage', () => {
  test('returns true for statuses ending with _FAILED', () => {
    expect(stackEventHasErrorMessage('CREATE_FAILED')).toBe(true);
    expect(stackEventHasErrorMessage('UPDATE_FAILED')).toBe(true);
    expect(stackEventHasErrorMessage('DELETE_FAILED')).toBe(true);
  });

  test('returns true for ROLLBACK_IN_PROGRESS', () => {
    expect(stackEventHasErrorMessage('ROLLBACK_IN_PROGRESS')).toBe(true);
  });

  test('returns true for UPDATE_ROLLBACK_IN_PROGRESS', () => {
    expect(stackEventHasErrorMessage('UPDATE_ROLLBACK_IN_PROGRESS')).toBe(true);
  });

  test('returns false for non-error statuses', () => {
    expect(stackEventHasErrorMessage('CREATE_COMPLETE')).toBe(false);
    expect(stackEventHasErrorMessage('UPDATE_COMPLETE')).toBe(false);
    expect(stackEventHasErrorMessage('DELETE_COMPLETE')).toBe(false);
    expect(stackEventHasErrorMessage('CREATE_IN_PROGRESS')).toBe(false);
    expect(stackEventHasErrorMessage('ROLLBACK_COMPLETE')).toBe(false);
    expect(stackEventHasErrorMessage('UPDATE_ROLLBACK_COMPLETE')).toBe(false);
  });
});

describe('maxResourceTypeLength', () => {
  test('returns startWidth for empty template', () => {
    const template = {};
    expect(maxResourceTypeLength(template)).toBe('AWS::CloudFormation::Stack'.length);
  });

  test('returns startWidth for template with no resources', () => {
    const template = { Resources: {} };
    expect(maxResourceTypeLength(template)).toBe('AWS::CloudFormation::Stack'.length);
  });

  test('returns startWidth when no resource type exceeds it', () => {
    const template = {
      Resources: {
        Resource1: { Type: 'AWS::S3::Bucket' },
        Resource2: { Type: 'AWS::IAM::Role' },
      },
    };
    expect(maxResourceTypeLength(template)).toBe('AWS::CloudFormation::Stack'.length);
  });

  test('returns length of longest resource type', () => {
    const longType = 'AWS::ServiceCatalog::CloudFormationProvisionedProduct';
    const template = {
      Resources: {
        Resource1: { Type: 'AWS::S3::Bucket' },
        Resource2: { Type: longType },
      },
    };
    expect(maxResourceTypeLength(template)).toBe(longType.length);
  });

  test('handles resources without Type property', () => {
    const template = {
      Resources: {
        Resource1: { Type: 'AWS::S3::Bucket' },
        Resource2: {},
      },
    };
    expect(maxResourceTypeLength(template)).toBe('AWS::CloudFormation::Stack'.length);
  });

  test('accepts custom startWidth', () => {
    const template = {
      Resources: {
        Resource1: { Type: 'AWS::S3::Bucket' },
      },
    };
    expect(maxResourceTypeLength(template, 50)).toBe(50);
  });

  test('handles null or undefined template', () => {
    expect(maxResourceTypeLength(null)).toBe('AWS::CloudFormation::Stack'.length);
    expect(maxResourceTypeLength(undefined)).toBe('AWS::CloudFormation::Stack'.length);
  });
});
