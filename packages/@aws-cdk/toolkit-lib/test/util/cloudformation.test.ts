import type { StackEvent } from '@aws-sdk/client-cloudformation';
import { validateSnsTopicArn, maxResourceTypeLength, isErrorEvent, stackNameFromArn, changeSetNameFromArn } from '../../lib/util/cloudformation';

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

function stackEventHasErrorMessage(status: StackEvent['ResourceStatus']) {
  return isErrorEvent({
    EventId: 'EventId',
    StackId: 'StackId',
    StackName: 'StackName',
    Timestamp: new Date(),
    ResourceStatus: status,
  });
}

describe('stackNameFromArn', () => {
  test('returns plain stack name as-is', () => {
    expect(stackNameFromArn('my-stack')).toBe('my-stack');
  });

  test('extracts stack name from a standard ARN', () => {
    expect(stackNameFromArn('arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/guid')).toBe('my-stack');
  });

  test('extracts stack name with hyphens and nested stack naming', () => {
    expect(stackNameFromArn(
      'arn:aws:cloudformation:us-east-1:312160754796:stack/amplify-cdkinteg0c4yeq1mqbr-kornherm-sandbo-amplifyDataAmplifyTableManagerNestedStackA-1XLFUMBAHXPWT/74a1c390-2910-11f1-b1a7-0e16f02188d7',
    )).toBe('amplify-cdkinteg0c4yeq1mqbr-kornherm-sandbo-amplifyDataAmplifyTableManagerNestedStackA-1XLFUMBAHXPWT');
  });

  test('extracts stack name from a gov-cloud partition ARN', () => {
    expect(stackNameFromArn('arn:aws-us-gov:cloudformation:us-gov-west-1:123456789012:stack/my-gov-stack/abc123')).toBe('my-gov-stack');
  });

  test('extracts stack name from a china partition ARN', () => {
    expect(stackNameFromArn('arn:aws-cn:cloudformation:cn-north-1:123456789012:stack/my-cn-stack/def456')).toBe('my-cn-stack');
  });
});

describe('changeSetNameFromArn', () => {
  test('returns plain change set name as-is', () => {
    expect(changeSetNameFromArn('my-changeset')).toBe('my-changeset');
  });

  test('extracts change set name from a standard ARN', () => {
    expect(changeSetNameFromArn('arn:aws:cloudformation:us-east-1:123456789012:changeSet/my-changeset/guid')).toBe('my-changeset');
  });

  test('extracts change set name from a gov-cloud partition ARN', () => {
    expect(changeSetNameFromArn('arn:aws-us-gov:cloudformation:us-gov-west-1:123456789012:changeSet/my-gov-changeset/abc123')).toBe('my-gov-changeset');
  });
});
