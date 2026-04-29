import type { DiagnosedStack, StackDiagnosis, TracedResourceError } from '../../../lib/actions/diagnose';
import { hostMessageFromDiagnosis, throwDeploymentErrorFromDiagnosis } from '../../../lib/api/diagnosing/diagnosis-formatting';
import type { ActionLessMessage } from '../../../lib/api/io/private';
import { DeploymentError, ToolkitError } from '../../../lib/toolkit/toolkit-error';

function diagnosedStack(stackName: string, result: StackDiagnosis): DiagnosedStack {
  return { stackName, hierarchicalId: stackName, result };
}

function tracedError(overrides: Partial<TracedResourceError> = {}): TracedResourceError {
  return {
    stackArn: 'arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/guid',
    topLevelStackHierarchicalId: 'MyStack',
    parentStackLogicalIds: [],
    logicalId: 'MyBucket',
    resourceType: 'AWS::S3::Bucket',
    message: 'Access Denied',
    sourceTrace: undefined,
    ...overrides,
  };
}

describe('hostMessageFromDiagnosis', () => {
  test('no-problem', () => {
    const msg = hostMessageFromDiagnosis(diagnosedStack('MyStack', { type: 'no-problem' }));
    expect(redactTime(msg)).toMatchSnapshot();
    expect(msg.code).toBe('CDK_TOOLKIT_I9500');
  });

  test('error-diagnosing', () => {
    const msg = hostMessageFromDiagnosis(diagnosedStack('MyStack', {
      type: 'error-diagnosing',
      message: 'Something went wrong',
    }));
    expect(redactTime(msg)).toMatchSnapshot();
    expect(msg.code).toBe('CDK_TOOLKIT_W9501');
  });

  test('deployment failure with resource errors', () => {
    const msg = hostMessageFromDiagnosis(diagnosedStack('MyStack', {
      type: 'problem',
      detectedBy: { type: 'deployment', stackStatus: 'UPDATE_FAILED', statusReason: 'Resource update failed' },
      problems: [
        tracedError({ logicalId: 'MyBucket', message: 'Access Denied', resourceType: 'AWS::S3::Bucket' }),
        tracedError({ logicalId: 'MyFunc', message: 'Handler error: timeout', resourceType: 'AWS::Lambda::Function' }),
      ],
    }));
    expect(redactTime(msg)).toMatchSnapshot();
    expect(msg.code).toBe('CDK_TOOLKIT_E9500');
  });

  test('deployment failure without resource errors', () => {
    const msg = hostMessageFromDiagnosis(diagnosedStack('MyStack', {
      type: 'problem',
      detectedBy: { type: 'deployment', stackStatus: 'UPDATE_FAILED', statusReason: 'Resource update failed' },
      problems: [],
    }));
    expect(redactTime(msg)).toMatchSnapshot();
  });

  test('change set failure with resource errors', () => {
    const msg = hostMessageFromDiagnosis(diagnosedStack('MyStack', {
      type: 'problem',
      detectedBy: { type: 'change-set', changeSetName: 'cdk-deploy-cs', changeSetStatus: 'FAILED', statusReason: 'Template error' },
      problems: [
        tracedError({ logicalId: 'MyBucket', message: 'Invalid property', resourceType: 'AWS::S3::Bucket' }),
      ],
    }));
    expect(redactTime(msg)).toMatchSnapshot();
  });

  test('change set failure without resource errors', () => {
    const msg = hostMessageFromDiagnosis(diagnosedStack('MyStack', {
      type: 'problem',
      detectedBy: { type: 'change-set', changeSetName: 'cdk-deploy-cs', changeSetStatus: 'FAILED', statusReason: 'Template format error' },
      problems: [],
    }));
    expect(redactTime(msg)).toMatchSnapshot();
  });

  test('early validation failure with resource errors', () => {
    const msg = hostMessageFromDiagnosis(diagnosedStack('MyStack', {
      type: 'problem',
      detectedBy: { type: 'early-validation', changeSetName: 'cdk-deploy-cs' },
      problems: [
        tracedError({ logicalId: 'MyBucket', message: 'Resource already exists (at /Resources/MyBucket)', resourceType: 'AWS::S3::Bucket' }),
      ],
    }));
    expect(redactTime(msg)).toMatchSnapshot();
  });

  test('resource error with source trace', () => {
    const msg = hostMessageFromDiagnosis(diagnosedStack('MyStack', {
      type: 'problem',
      detectedBy: { type: 'deployment', stackStatus: 'UPDATE_FAILED', statusReason: 'failed' },
      problems: [
        tracedError({
          logicalId: 'MyBucket',
          message: 'Access Denied',
          sourceTrace: {
            constructPath: 'MyStack/MyBucket/Resource',
            creationStackTrace: ['at new Bucket (lib/bucket.ts:42)', 'at new MyStack (lib/stack.ts:10)'],
          },
        }),
      ],
    }));
    expect(redactTime(msg)).toMatchSnapshot();
  });

  test('resource error in nested stack without source trace', () => {
    const msg = hostMessageFromDiagnosis(diagnosedStack('MyStack', {
      type: 'problem',
      detectedBy: { type: 'deployment', stackStatus: 'UPDATE_FAILED', statusReason: 'failed' },
      problems: [
        tracedError({
          logicalId: 'MyBucket',
          parentStackLogicalIds: ['NestedStackA'],
          message: 'Access Denied',
          sourceTrace: undefined,
        }),
      ],
    }));
    expect(redactTime(msg)).toMatchSnapshot();
  });
});

describe('throwDeploymentErrorFromDiagnosis', () => {
  test('throws ToolkitError for no-problem', () => {
    expect(() => throwDeploymentErrorFromDiagnosis({ type: 'no-problem' })).toThrow(ToolkitError);
  });

  test('throws DeploymentError for error-diagnosing', () => {
    expect(() => throwDeploymentErrorFromDiagnosis({
      type: 'error-diagnosing',
      message: 'Could not diagnose',
    })).toThrow(DeploymentError);
  });

  test('throws DeploymentError with correct error code for deployment failure', () => {
    expect(() => throwDeploymentErrorFromDiagnosis({
      type: 'problem',
      detectedBy: { type: 'deployment', stackStatus: 'UPDATE_FAILED', statusReason: 'failed' },
      problems: [tracedError({ errorCode: 'S3:AccessDenied' })],
    })).toThrow(expect.objectContaining({
      deploymentErrorCode: 'S3:AccessDenied',
    }));
  });

  test('throws DeploymentError with default error code for change set failure', () => {
    expect(() => throwDeploymentErrorFromDiagnosis({
      type: 'problem',
      detectedBy: { type: 'change-set', changeSetName: 'cs', changeSetStatus: 'FAILED', statusReason: 'err' },
      problems: [tracedError()],
    })).toThrow(expect.objectContaining({
      deploymentErrorCode: 'ChangeSetCreationFailed',
    }));
  });

  test('throws DeploymentError with default error code for early validation failure', () => {
    expect(() => throwDeploymentErrorFromDiagnosis({
      type: 'problem',
      detectedBy: { type: 'early-validation', changeSetName: 'cs' },
      problems: [tracedError()],
    })).toThrow(expect.objectContaining({
      deploymentErrorCode: 'EarlyValidationFailure',
    }));
  });
});

function redactTime<A extends ActionLessMessage<any>>(msg: A): A {
  (msg as any).time = new Date(0);
  return msg;
}
