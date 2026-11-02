import type { Change } from '@aws-sdk/client-cloudformation';

/**
 * The value `Stack.toJsonString({ stack: Aws.STACK_NAME, ...values })` renders
 */
export function jsonWithStackName(values: Record<string, string>) {
  return { 'Fn::Join': ['', ['{"stack":"', { Ref: 'AWS::StackName' }, `",${JSON.stringify(values).slice(1)}`]] };
}

/**
 * The change CloudFormation reports, without property values, for a changed SSM parameter value
 */
export function parameterValueChange(logicalId: string): Change {
  return {
    Type: 'Resource',
    ResourceChange: {
      Action: 'Modify',
      LogicalResourceId: logicalId,
      ResourceType: 'AWS::SSM::Parameter',
      Replacement: 'False',
      Scope: ['Properties'],
      Details: [{
        Target: { Attribute: 'Properties', Name: 'Value', RequiresRecreation: 'Never' },
        Evaluation: 'Static',
        ChangeSource: 'DirectModification',
      }],
    },
  };
}
