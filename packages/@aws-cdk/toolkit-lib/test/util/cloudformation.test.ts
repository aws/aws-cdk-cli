import type { StackEvent } from '@aws-sdk/client-cloudformation';
import { RollbackTriggerType } from '../../lib/actions/deploy';
import { ToolkitError } from '../../lib/toolkit/toolkit-error';
import { validateSnsTopicArn, validateCloudWatchAlarmArn, toCloudFormationRollbackConfiguration, maxResourceTypeLength, isErrorEvent, stackNameFromArn, changeSetNameFromArn } from '../../lib/util/cloudformation';

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

describe('validateCloudWatchAlarmArn', () => {
  test('empty string is invalid', () => {
    expect(validateCloudWatchAlarmArn('')).toEqual(false);
  });

  test('an SNS topic arn is not a valid alarm arn', () => {
    expect(validateCloudWatchAlarmArn('arn:aws:sns:eu-west-1:123456789012:foo')).toEqual(false);
  });

  test('a metric alarm arn is valid', () => {
    expect(validateCloudWatchAlarmArn('arn:aws:cloudwatch:us-east-1:123456789012:alarm:MyAlarm')).toEqual(true);
  });

  test('an alarm arn with special characters in the name is valid', () => {
    expect(validateCloudWatchAlarmArn('arn:aws:cloudwatch:us-east-1:123456789012:alarm:My-Alarm_1 with spaces')).toEqual(true);
  });

  test('gov-cloud partition alarm arn is valid', () => {
    expect(validateCloudWatchAlarmArn('arn:aws-us-gov:cloudwatch:us-gov-west-1:123456789012:alarm:MyAlarm')).toEqual(true);
  });

  test('an arn without an alarm name is invalid', () => {
    expect(validateCloudWatchAlarmArn('arn:aws:cloudwatch:us-east-1:123456789012:alarm:')).toEqual(false);
  });
});

describe('toCloudFormationRollbackConfiguration', () => {
  test('returns undefined when no configuration is provided', () => {
    expect(toCloudFormationRollbackConfiguration(undefined)).toBeUndefined();
  });

  test('an empty configuration clears triggers', () => {
    expect(toCloudFormationRollbackConfiguration({})).toEqual({
      RollbackTriggers: [],
      MonitoringTimeInMinutes: undefined,
    });
  });

  test('defaults the trigger type to a metric alarm', () => {
    expect(toCloudFormationRollbackConfiguration({
      triggers: [{ arn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:MyAlarm' }],
      monitoringTimeInMinutes: 15,
    })).toEqual({
      RollbackTriggers: [
        { Arn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:MyAlarm', Type: 'AWS::CloudWatch::Alarm' },
      ],
      MonitoringTimeInMinutes: 15,
    });
  });

  test('honours an explicit composite alarm type', () => {
    expect(toCloudFormationRollbackConfiguration({
      triggers: [{
        arn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:MyComposite',
        type: RollbackTriggerType.COMPOSITE_ALARM,
      }],
    })).toEqual({
      RollbackTriggers: [
        { Arn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:MyComposite', Type: 'AWS::CloudWatch::CompositeAlarm' },
      ],
      MonitoringTimeInMinutes: undefined,
    });
  });

  test('throws when more than 5 triggers are specified', () => {
    const triggers = Array.from({ length: 6 }, (_, i) => ({
      arn: `arn:aws:cloudwatch:us-east-1:123456789012:alarm:Alarm${i}`,
    }));
    expect(() => toCloudFormationRollbackConfiguration({ triggers })).toThrow(ToolkitError);
    expect(() => toCloudFormationRollbackConfiguration({ triggers })).toThrow(/maximum of 5 rollback triggers/);
  });

  test('throws on an invalid alarm arn', () => {
    expect(() => toCloudFormationRollbackConfiguration({
      triggers: [{ arn: 'arn:aws:sns:us-east-1:123456789012:not-an-alarm' }],
    })).toThrow(/not a valid CloudWatch alarm arn/);
  });

  test.each([-1, 181])('throws when monitoring time %d is out of range', (monitoringTimeInMinutes) => {
    expect(() => toCloudFormationRollbackConfiguration({ monitoringTimeInMinutes })).toThrow(/monitoring time must be between 0 and 180/);
  });

  test.each([0, 180])('accepts monitoring time %d at the range boundary', (monitoringTimeInMinutes) => {
    expect(toCloudFormationRollbackConfiguration({ monitoringTimeInMinutes })).toEqual({
      RollbackTriggers: [],
      MonitoringTimeInMinutes: monitoringTimeInMinutes,
    });
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
