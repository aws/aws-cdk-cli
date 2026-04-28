import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import type { DescribeChangeSetOutput } from '@aws-cdk/cloudformation-diff';
import type {
  CreateChangeSetCommandInput,
  ExecuteChangeSetCommandInput,
  Stack,
  Change,
} from '@aws-sdk/client-cloudformation';
import {
  ChangeSetStatus,
  ChangeSetType,
  CreateChangeSetCommand,
  CreateStackCommand,
  DeleteChangeSetCommand,
  DeleteStackCommand,
  DescribeChangeSetCommand,
  DescribeEventsCommand,
  DescribeStacksCommand,
  ExecuteChangeSetCommand,
  GetTemplateCommand,
  StackStatus,
  UpdateStackCommand,
  UpdateTerminationProtectionCommand,
} from '@aws-sdk/client-cloudformation';
import { assertIsSuccessfulDeployStackResult } from '../../../lib/api/deployments';
import type { DeployStackOptions as DeployStackApiOptions } from '../../../lib/api/deployments/deploy-stack';
import { deployStack } from '../../../lib/api/deployments/deploy-stack';
import { CloudFormationStackDiagnoser } from '../../../lib/api/diagnosing/stack-diagnoser';
import { NoBootstrapStackEnvironmentResources } from '../../../lib/api/environment';
import { tryHotswapDeployment } from '../../../lib/api/hotswap/hotswap-deployments';
import { invalidateHotswapTemplateCache, writeHotswapTemplateCache } from '../../../lib/api/hotswap/hotswap-template-cache';
import { StackArtifactSourceTracer } from '../../../lib/api/source-tracing/private/stack-source-tracing';
import { testStack } from '../../_helpers/assembly';
import { FakeCloudFormation } from '../../_helpers/fake-aws/fake-cloudformation';
import { advanceTime } from '../../_helpers/fake-time';
import {
  mockCloudFormationClient,
  mockResolvedEnvironment,
  MockSdk,
  MockSdkProvider,
  restoreSdkMocksToDefault,
} from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

let ioHost = new TestIoHost();
let ioHelper = ioHost.asHelper('deploy');

function testDeployStack(options: DeployStackApiOptions) {
  return advanceTime(deployStack(options, ioHelper));
}

jest.mock('../../../lib/api/hotswap/hotswap-deployments');
jest.mock('../../../lib/api/hotswap/hotswap-template-cache');
jest.mock('../../../lib/api/deployments/checks', () => ({
  determineAllowCrossAccountAssetPublishing: jest.fn().mockResolvedValue(true),
}));

const FAKE_STACK = testStack({
  stackName: 'withouterrors',
  template: defaultTargetTemplate(),
});

const FAKE_STACK_WITH_NESTED_STACK = testStack({
  stackName: 'withnestedstack',
  template: {
    Resources: {
      NestedStack: {
        Type: 'AWS::CloudFormation::Stack',
        Properties: {
          TemplateURL: 'https://example.com/template.json',
        },
      },
    },
  },
});

const FAKE_STACK_WITH_PARAMETERS = testStack({
  stackName: 'withparameters',
  template: {
    Parameters: {
      HasValue: { Type: 'String' },
      HasDefault: { Type: 'String', Default: 'TheDefault' },
      OtherParameter: { Type: 'String' },
    },
  },
});

const FAKE_STACK_TERMINATION_PROTECTION = testStack({
  stackName: 'termination-protection',
  template: defaultStartTemplate(),
  terminationProtection: true,
});

const baseResponse = {
  StackName: 'mock-stack-name',
  StackId: 'mock-stack-id',
  CreationTime: new Date(),
  StackStatus: StackStatus.CREATE_COMPLETE,
  EnableTerminationProtection: false,
};

let sdk: MockSdk;
let sdkProvider: MockSdkProvider;
const fakeCfn = new FakeCloudFormation();

beforeEach(() => {
  fakeCfn.reset();

  sdkProvider = new MockSdkProvider();
  sdk = new MockSdk();
  sdk.getUrlSuffix = () => Promise.resolve('amazonaws.com');
  jest.resetAllMocks();

  restoreSdkMocksToDefault();
  fakeCfn.installUsingAwsMock(mockCloudFormationClient);

  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function standardDeployStackArguments(stack: CloudFormationStackArtifact = FAKE_STACK): DeployStackApiOptions {
  const resolvedEnvironment = mockResolvedEnvironment();
  return {
    stack,
    sdk,
    sdkProvider,
    resolvedEnvironment,
    envResources: new NoBootstrapStackEnvironmentResources(resolvedEnvironment, sdk, ioHelper),
    diagnoser: new CloudFormationStackDiagnoser({
      sdk,
      sourceTracer: new StackArtifactSourceTracer(stack),
      ioHelper,
      topLevelStackHierarchicalId: stack.hierarchicalId,
    }),
  };
}

test('calls tryHotswapDeployment() if deploymentMethod is hotswap with fallback', async () => {
  // WHEN
  const spyOnSdk = jest.spyOn(sdk, 'appendCustomUserAgent');
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'hotswap', fallback: { method: 'change-set' } },
    extraUserAgent: 'extra-user-agent',
  });

  // THEN
  expect(tryHotswapDeployment).toHaveBeenCalled();
  // check that the extra User-Agent is honored
  expect(spyOnSdk).toHaveBeenCalledWith('extra-user-agent');
  // check that the fallback has been called if hotswapping failed
  expect(spyOnSdk).toHaveBeenCalledWith('cdk-hotswap/fallback');
});

test('calls tryHotswapDeployment() if deploymentMethod is hotswap-only', async () => {
  // we need the first call to return something in the Stacks prop,
  // otherwise the access to `stackId` will fail
  givenStackExists();
  const spyOnSdk = jest.spyOn(sdk, 'appendCustomUserAgent');
  // WHEN
  const deployStackResult = await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'hotswap' },
    extraUserAgent: 'extra-user-agent',
    forceDeployment: true, // otherwise, deployment would be skipped
  });

  // THEN
  expect(deployStackResult.type === 'did-deploy-stack' && deployStackResult.noOp).toEqual(true);
  expect(tryHotswapDeployment).toHaveBeenCalled();
  // check that the extra User-Agent is honored
  expect(spyOnSdk).toHaveBeenCalledWith('extra-user-agent');
  // check that the fallback has not been called if hotswapping failed
  expect(spyOnSdk).not.toHaveBeenCalledWith('cdk-hotswap/fallback');
});

test('correctly passes CFN parameters when hotswapping', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'hotswap', fallback: { method: 'change-set' } },
    parameters: {
      A: 'A-value',
      B: 'B=value',
      C: undefined,
      D: '',
    },
  });

  // THEN
  expect(tryHotswapDeployment).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    { A: 'A-value', B: 'B=value' },
    expect.anything(),
    expect.anything(),
    'fall-back',
    expect.anything(),
  );
});

test('correctly passes SSM parameters when hotswapping', async () => {
  // GIVEN
  givenStackExists({
    StackName: 'stack',
    Parameters: [{ ParameterKey: 'SomeParameter', ParameterValue: 'ParameterName', ResolvedValue: 'SomeValue' }],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(
      testStack({
        stackName: 'stack',
        template: {
          Parameters: {
            SomeParameter: {
              Type: 'AWS::SSM::Parameter::Value<String>',
              Default: 'ParameterName',
            },
          },
        },
      }),
    ),
    deploymentMethod: { method: 'hotswap', fallback: { method: 'change-set' } },
    usePreviousParameters: true,
  });

  // THEN
  expect(tryHotswapDeployment).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    { SomeParameter: 'SomeValue' },
    expect.anything(),
    expect.anything(),
    'fall-back',
    expect.anything(),
  );
});

describe('hotswap template cache', () => {
  test('writeHotswapTemplateCache is called on a successful hotswap deployment', async () => {
    // GIVEN
    (tryHotswapDeployment as jest.Mock).mockImplementation(async () => {
      await writeHotswapTemplateCache('assembly-dir', 'withouterrors', {}, {});
      return { type: 'did-deploy-stack', noOp: false, stackArn: 'arn:stack', outputs: {} };
    });

    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: { method: 'hotswap', fallback: { method: 'change-set' } },
    });

    // THEN
    expect(writeHotswapTemplateCache).toHaveBeenCalled();
    expect(invalidateHotswapTemplateCache).not.toHaveBeenCalled();
  });

  test('invalidateHotswapTemplateCache is called on a non-hotswap deployment', async () => {
    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: { method: 'change-set' },
    });

    // THEN
    expect(invalidateHotswapTemplateCache).toHaveBeenCalled();
  });

  test('invalidateHotswapTemplateCache is called on a hotswap fallback deployment', async () => {
    // GIVEN - hotswap fails (returns undefined), falls back to full CFN
    (tryHotswapDeployment as jest.Mock).mockResolvedValue(undefined);

    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: { method: 'hotswap', fallback: { method: 'change-set' } },
    });

    // THEN
    expect(tryHotswapDeployment).toHaveBeenCalled();
    expect(invalidateHotswapTemplateCache).toHaveBeenCalled();
  });
});

test('call CreateStack when method=direct and the stack doesnt exist yet', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'direct' },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateStackCommand);
});

test('execute-change-set describes and executes an existing change set', async () => {
  // GIVEN - stack and change set exist
  givenStackExists();
  givenChangeSetExists({ ChangeSetName: 'MyChangeSet', Status: ChangeSetStatus.CREATE_COMPLETE });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'execute-change-set', changeSetName: 'MyChangeSet' },
  });

  // THEN - should execute the change set without creating a new one
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateChangeSetCommand);
});

test('execute-change-set throws if change set is not ready', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [{ ...baseResponse }],
  });
  mockCloudFormationClient.on(DescribeChangeSetCommand).resolves({
    Status: 'FAILED',
    StatusReason: 'some reason',
  });

  // WHEN/THEN
  await expect(testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'execute-change-set', changeSetName: 'MyChangeSet' },
  })).rejects.toThrow('not ready for execution');
});

test('call UpdateStack when method=direct and the stack exists already', async () => {
  // WHEN
  givenStackExists();

  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'direct' },
    forceDeployment: true,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(UpdateStackCommand);
});

test('method=direct and no updates to be performed', async () => {
  // WHEN
  givenNoUpdatesAreToBePerformed();

  const ret = await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'direct' },
    forceDeployment: true,
  });

  // THEN
  expect(ret).toEqual(expect.objectContaining({ noOp: true }));
});

test('does not call tryHotswapDeployment() if deploymentMethod is not hotswap', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(tryHotswapDeployment).not.toHaveBeenCalled();
});

test("rollback still defaults to enabled even if 'hotswap' is enabled", async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'hotswap', fallback: { method: 'change-set' } },
    rollback: undefined,
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommandWith(
    ExecuteChangeSetCommand,
    expect.objectContaining({
      DisableRollback: true,
    }),
  );
});

test('rollback defaults to enabled if deploymentMethod is not hotswap', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    rollback: undefined,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandTimes(ExecuteChangeSetCommand, 1);
  expect(mockCloudFormationClient).not.toHaveReceivedCommandWith(
    ExecuteChangeSetCommand,
    expect.objectContaining({
      DisableRollback: true,
    }),
  );
});

test('do deploy executable change set with 0 changes', async () => {
  // WHEN
  const ret = await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(ret.type === 'did-deploy-stack' && ret.noOp).toBeFalsy();
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('correctly passes CFN parameters, ignoring ones with empty values', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    parameters: {
      A: 'A-value',
      B: 'B=value',
      C: undefined,
      D: '',
    },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    Parameters: [
      { ParameterKey: 'A', ParameterValue: 'A-value' },
      { ParameterKey: 'B', ParameterValue: 'B=value' },
    ],
    TemplateBody: expect.any(String),
  } as CreateChangeSetCommandInput);
});

test('reuse previous parameters if requested', async () => {
  // GIVEN
  givenStackExists({
    StackName: 'withparameters',
    Parameters: [
      { ParameterKey: 'HasValue', ParameterValue: 'TheValue' },
      { ParameterKey: 'HasDefault', ParameterValue: 'TheOldValue' },
    ],
  });
  givenTemplateIs(FAKE_STACK_WITH_PARAMETERS.template);

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(FAKE_STACK_WITH_PARAMETERS),
    parameters: {
      OtherParameter: 'SomeValue',
    },
    usePreviousParameters: true,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    Parameters: [
      { ParameterKey: 'HasValue', UsePreviousValue: true },
      { ParameterKey: 'HasDefault', UsePreviousValue: true },
      { ParameterKey: 'OtherParameter', ParameterValue: 'SomeValue' },
    ],
  } as CreateChangeSetCommandInput);
});

test('do not reuse previous parameters if not requested', async () => {
  // GIVEN
  givenStackExists({
    StackName: 'withparameters',
    Parameters: [
      { ParameterKey: 'HasValue', ParameterValue: 'TheValue' },
      { ParameterKey: 'HasDefault', ParameterValue: 'TheOldValue' },
    ],
  });
  givenTemplateIs(FAKE_STACK_WITH_PARAMETERS.template);

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(FAKE_STACK_WITH_PARAMETERS),
    parameters: {
      HasValue: 'SomeValue',
      OtherParameter: 'SomeValue',
    },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.UPDATE,
    Parameters: [
      { ParameterKey: 'HasValue', ParameterValue: 'SomeValue' },
      { ParameterKey: 'OtherParameter', ParameterValue: 'SomeValue' },
    ],
  } as CreateChangeSetCommandInput);
});

test('throw exception if not enough parameters supplied', async () => {
  // GIVEN
  givenStackExists({
    StackName: 'withparameters',
    Parameters: [
      { ParameterKey: 'HasValue', ParameterValue: 'TheValue' },
      { ParameterKey: 'HasDefault', ParameterValue: 'TheOldValue' },
    ],
  });
  givenTemplateIs(FAKE_STACK_WITH_PARAMETERS.template);

  // WHEN
  await expect(
    testDeployStack({
      ...standardDeployStackArguments(FAKE_STACK_WITH_PARAMETERS),
      parameters: {
        OtherParameter: 'SomeValue',
      },
    }),
  ).rejects.toThrow(/CloudFormation Parameters are missing a value/);
});

test('deploy is skipped if template did not change', async () => {
  // GIVEN
  givenNoUpdatesAreToBePerformed();

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('deploy is skipped if parameters are the same', async () => {
  // GIVEN
  givenStackExists({
    StackName: 'withparameters',
    Parameters: [
      { ParameterKey: 'HasValue', ParameterValue: 'TheValue' },
      { ParameterKey: 'HasDefault', ParameterValue: 'TheOldValue' },
      { ParameterKey: 'OtherParameter', ParameterValue: 'OtherParameter' },
    ],
  });
  givenTemplateIs(FAKE_STACK_WITH_PARAMETERS.template);

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(FAKE_STACK_WITH_PARAMETERS),
    parameters: {},
    usePreviousParameters: true,
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateChangeSetCommand);
});

test('deploy is not skipped if parameters are different', async () => {
  // GIVEN
  givenStackExists({
    StackName: 'withparameters',
    Parameters: [
      { ParameterKey: 'HasValue', ParameterValue: 'TheValue' },
      { ParameterKey: 'HasDefault', ParameterValue: 'TheOldValue' },
      { ParameterKey: 'OtherParameter', ParameterValue: 'OtherParameter' },
    ],
  });
  givenTemplateIs(FAKE_STACK_WITH_PARAMETERS.template);

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(FAKE_STACK_WITH_PARAMETERS),
    parameters: {
      HasValue: 'NewValue',
    },
    usePreviousParameters: true,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.UPDATE,
    Parameters: [
      { ParameterKey: 'HasValue', ParameterValue: 'NewValue' },
      { ParameterKey: 'HasDefault', UsePreviousValue: true },
      { ParameterKey: 'OtherParameter', UsePreviousValue: true },
    ],
  } as CreateChangeSetCommandInput);
});

test('deploy is skipped if notificationArns are the same', async () => {
  // GIVEN
  givenStackExists({
    NotificationARNs: ['arn:aws:sns:bermuda-triangle-1337:123456789012:TestTopic'],
  });
  givenTemplateIs(FAKE_STACK.template);

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(FAKE_STACK),
    notificationArns: ['arn:aws:sns:bermuda-triangle-1337:123456789012:TestTopic'],
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateChangeSetCommand);
});

test('deploy is not skipped if notificationArns are different', async () => {
  // GIVEN
  givenStackExists({
    NotificationARNs: ['arn:aws:sns:bermuda-triangle-1337:123456789012:TestTopic'],
  });
  givenTemplateIs(FAKE_STACK.template);

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(FAKE_STACK),
    notificationArns: ['arn:aws:sns:bermuda-triangle-1337:123456789012:MagicTopic'],
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
});

test('if existing stack failed to create, it is deleted and recreated', async () => {
  // GIVEN
  givenStackExists({
    StackStatus: StackStatus.ROLLBACK_COMPLETE,
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(DeleteStackCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.CREATE,
  } as CreateChangeSetCommandInput);
});

test('if existing stack failed to create, it is deleted and recreated even if the template did not change', async () => {
  // GIVEN
  mockCloudFormationClient
    .on(DescribeStacksCommand)
    .resolvesOnce({
      Stacks: [
        {
          ...baseResponse,
          StackStatus: StackStatus.ROLLBACK_COMPLETE,
        },
      ],
    })
    .resolvesOnce({
      Stacks: [
        {
          ...baseResponse,
          StackStatus: StackStatus.DELETE_COMPLETE,
        },
      ],
    })
    .resolves({
      Stacks: [
        {
          ...baseResponse,
          StackStatus: StackStatus.CREATE_COMPLETE,
        },
      ],
    });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(DeleteStackCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.CREATE,
  } as CreateChangeSetCommandInput);
});

test('deploy not skipped if template did not change and --force is applied', async () => {
  // GIVEN
  givenStackExists();
  givenTemplateIs({ DifferentThan: 'TheDefault' });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    forceDeployment: true,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandTimes(ExecuteChangeSetCommand, 1);
});

test('deploy is skipped if template and tags did not change', async () => {
  // GIVEN
  givenStackExists({
    Tags: [
      { Key: 'Key1', Value: 'Value1' },
      { Key: 'Key2', Value: 'Value2' },
    ],
  });
  givenTemplateIs(defaultTargetTemplate());

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    tags: [
      { Key: 'Key1', Value: 'Value1' },
      { Key: 'Key2', Value: 'Value2' },
    ],
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeStacksCommand, {
    StackName: 'withouterrors',
  });
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(GetTemplateCommand, {
    StackName: 'withouterrors',
    TemplateStage: 'Original',
  });
});

test('deploy not skipped if template did not change but tags changed', async () => {
  // GIVEN
  givenStackExists({
    Tags: [{ Key: 'Key', Value: 'Value' }],
  });

  // WHEN
  const resolvedEnvironment = mockResolvedEnvironment();
  await testDeployStack({
    stack: FAKE_STACK,
    sdk,
    sdkProvider,
    resolvedEnvironment,
    tags: [
      {
        Key: 'Key',
        Value: 'NewValue',
      },
    ],
    envResources: new NoBootstrapStackEnvironmentResources(resolvedEnvironment, sdk, ioHelper),
    diagnoser: new CloudFormationStackDiagnoser({
      sdk,
      sourceTracer: {
        traceResource: () => Promise.resolve(undefined),
        traceStack: () => Promise.resolve(undefined),
      },
      ioHelper,
      topLevelStackHierarchicalId: FAKE_STACK.hierarchicalId,
    }),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeStacksCommand, {
    StackName: 'withouterrors',
  });
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(GetTemplateCommand, {
    StackName: 'withouterrors',
    TemplateStage: 'Original',
  });
});

test('deployStack reports no change if describeChangeSet returns an error that indicates no change', async () => {
  // GIVEN — force the change set to report no changes
  givenStackExists();
  fakeCfn.overrideChangeSetChanges = [];

  // WHEN
  const deployResult = await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(deployResult.type === 'did-deploy-stack' && deployResult.noOp).toEqual(true);
});

test('deployStack throws error in case of early validation failures', async () => {
  mockCloudFormationClient.on(DescribeChangeSetCommand).resolvesOnce({
    ChangeSetName: 'cdk-deploy-change-set',
    Status: ChangeSetStatus.FAILED,
    StatusReason: '(AWS::EarlyValidation::SomeError). Blah blah blah.',
  });

  mockCloudFormationClient.on(DescribeEventsCommand).resolves({
    OperationEvents: [
      {
        ValidationStatus: 'FAILED',
        ValidationStatusReason: 'Resource already exists',
        ValidationPath: 'Resources/MyResource',
      },
    ],
  });

  await expect(
    testDeployStack({
      ...standardDeployStackArguments(),
    }),
  ).rejects.toThrow('Early validation failed for change set cdk-deploy-change-set');
});

test('deployStack warns when it cannot get the events in case of early validation errors', async () => {
  mockCloudFormationClient.on(DescribeChangeSetCommand).resolvesOnce({
    ChangeSetName: 'cdk-deploy-change-set',
    Status: ChangeSetStatus.FAILED,
    StatusReason: '(AWS::EarlyValidation::SomeError). Blah blah blah.',
  });

  mockCloudFormationClient.on(DescribeEventsCommand).rejectsOnce({
    message: 'AccessDenied',
  });

  await expect(
    testDeployStack({
      ...standardDeployStackArguments(),
    }),
  ).rejects.toThrow('Early validation failed for change set cdk-deploy-change-set');
});

test('deploy not skipped if template did not change but one tag removed', async () => {
  // GIVEN
  givenStackExists({
    Tags: [
      { Key: 'Key1', Value: 'Value1' },
      { Key: 'Key2', Value: 'Value2' },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    tags: [{ Key: 'Key1', Value: 'Value1' }],
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeStacksCommand, {
    StackName: 'withouterrors',
  });
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(GetTemplateCommand, {
    StackName: 'withouterrors',
    TemplateStage: 'Original',
  });
});

test('deploy is not skipped if stack is in a _FAILED state', async () => {
  // GIVEN
  givenStackExists({
    StackStatus: StackStatus.DELETE_FAILED,
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    usePreviousParameters: true,
  }).catch(() => {
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('existing stack in UPDATE_ROLLBACK_COMPLETE state can be updated', async () => {
  // GIVEN
  givenStackExists({
    StackStatus: StackStatus.UPDATE_ROLLBACK_COMPLETE,
  });
  givenTemplateIs({ changed: 123 });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(DeleteStackCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.UPDATE,
  } as CreateChangeSetCommandInput);
});

test('deploy not skipped if template changed', async () => {
  // GIVEN
  givenStackExists();
  givenTemplateIs({ changed: 123 });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('not executed and no error if --no-execute is given', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'change-set', execute: false },
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('empty change set is deleted if --execute is given', async () => {
  givenNoUpdatesAreToBePerformed();

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'change-set', execute: true },
    forceDeployment: true, // Necessary to bypass "skip deploy"
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);

  // the first deletion is for any existing cdk change sets, the second is for the deleting the new empty change set
  expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DeleteChangeSetCommand, 2);
});

test('empty change set is not deleted if --no-execute is given', async () => {
  givenStackExists();
  givenCurrentChangeSetIsEmpty();

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'change-set', execute: false },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);

  // the first deletion is for any existing cdk change sets
  expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DeleteChangeSetCommand, 1);
});

test('use S3 url for stack deployment if present in Stack Artifact', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    stack: testStack({
      stackName: 'withouterrors',
      properties: {
        stackTemplateAssetObjectUrl: 'https://use-me-use-me/',
      },
    }),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    TemplateURL: 'https://use-me-use-me/',
  } as CreateChangeSetCommandInput);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('use REST API S3 url with substituted placeholders if manifest url starts with s3://', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(
      testStack({
        stackName: 'withouterrors',
        properties: {
          stackTemplateAssetObjectUrl: 's3://use-me-use-me-${AWS::AccountId}/object',
        },
      }),
    ),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    TemplateURL: 'https://s3.bermuda-triangle-1337.amazonaws.com/use-me-use-me-123456789/object',
  } as CreateChangeSetCommandInput);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('changeset is created when stack exists in REVIEW_IN_PROGRESS status', async () => {
  // GIVEN
  givenStackExists({
    StackStatus: StackStatus.REVIEW_IN_PROGRESS,
    Tags: [
      { Key: 'Key1', Value: 'Value1' },
      { Key: 'Key2', Value: 'Value2' },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'change-set', execute: false },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.CREATE,
    StackName: 'withouterrors',
  } as CreateChangeSetCommandInput);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('changeset is updated when stack exists in CREATE_COMPLETE status', async () => {
  // GIVEN
  givenStackExists({
    Tags: [
      { Key: 'Key1', Value: 'Value1' },
      { Key: 'Key2', Value: 'Value2' },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'change-set', execute: false },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.UPDATE,
    StackName: 'withouterrors',
  } as CreateChangeSetCommandInput);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('deploy with termination protection enabled', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(FAKE_STACK_TERMINATION_PROTECTION),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(UpdateTerminationProtectionCommand, {
    StackName: 'termination-protection',
    EnableTerminationProtection: true,
  });
});

test('updateTerminationProtection not called when termination protection is undefined', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(UpdateTerminationProtectionCommand);
});

test('updateTerminationProtection called when termination protection is undefined and stack has termination protection', async () => {
  // GIVEN
  givenStackExists({
    EnableTerminationProtection: true,
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(UpdateTerminationProtectionCommand, {
    StackName: 'withouterrors',
    EnableTerminationProtection: false,
  });
});

describe('disable rollback', () => {
  test('by default, we do not disable rollback (and also do not pass the flag)', async () => {
    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
    });

    // THEN
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(ExecuteChangeSetCommand, 1);
    expect(mockCloudFormationClient).not.toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
      DisableRollback: expect.anything,
      ChangeSetName: expect.any(String),
    });
  });

  test('rollback can be disabled by setting rollback: false', async () => {
    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
      rollback: false,
    });

    // THEN
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
      ...expect.anything,
      DisableRollback: true,
    } as ExecuteChangeSetCommandInput);
  });
});

describe('import-existing-resources', () => {
  test('is disabled by default', async () => {
    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: {
        method: 'change-set',
      },
    });

    // THEN
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
      ...expect.anything,
      ImportExistingResources: false,
    } as CreateChangeSetCommandInput);
  });

  test('is added to the CreateChangeSetCommandInput', async () => {
    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: {
        method: 'change-set',
        importExistingResources: true,
      },
    });

    // THEN
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
      ...expect.anything,
      ImportExistingResources: true,
    } as CreateChangeSetCommandInput);
  });

  test('enhances error message with construct paths when changeset fails', async () => {
    // GIVE
    const stack = testStack({
      stackName: 'import-error-stack',
      template: {
        Resources: {
          DashboardsMyRoleABC123: {
            Type: 'AWS::IAM::Role',
            Metadata: { 'aws:cdk:path': 'import-error-stack/Dashboards/MyRole/Resource' },
          },
          AnotherResourceABC123: {
            Type: 'AWS::S3::Bucket',
            Metadata: { 'aws:cdk:path': 'import-error-stack/MyService/AnotherResource/Resource' },
          },
        },
      },
    });

    givenStackExists();
    fakeCfn.overrideChangeSetStatus = {
      status: 'FAILED',
      statusReason:
        'CloudFormation is attempting to import some resources because they already exist in your account. ' +
        "The resources must have the DeletionPolicy attribute set to 'Retain' or 'RetainExceptOnCreate' in the template for successful import. " +
        'The affected resources are DashboardsMyRoleABC123 ({RoleName=CloudWatchDashboards}), AnotherResourceABC123 ({BucketName=my-bucket})',
      executionStatus: 'UNAVAILABLE',
    };

    // THEN
    await expect(
      testDeployStack({
        ...standardDeployStackArguments(stack),
        deploymentMethod: {
          method: 'change-set',
          importExistingResources: true,
        },
      }),
    ).rejects.toMatchInlineSnapshot(`
      [DeploymentError: Failed to create change set cdk-deploy-change-set:
       └─ import-error-stack
           ├─ Dashboards
           │   └─ MyRole
           │       └─ Resource  (DashboardsMyRoleABC123)
           │          🛑 Automatic import of existing resource DashboardsMyRoleABC123 ({RoleName=CloudWatchDashboards}) needs a DeletionPolicy of
           │             'Retain' or 'RetainExceptOnCreate'. Set the removal policy to 'RemovalPolicy.RETAIN' or
           │             'RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE' (See
           │             https://docs.aws.amazon.com/cdk/v2/guide/resources.html#resources-removal)
           └─ MyService
               └─ AnotherResource
                   └─ Resource  (AnotherResourceABC123)
                      🛑 Automatic import of existing resource AnotherResourceABC123 ({BucketName=my-bucket}) needs a DeletionPolicy of 'Retain'
                         or 'RetainExceptOnCreate'. Set the removal policy to 'RemovalPolicy.RETAIN' or
                         'RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE' (See
                         https://docs.aws.amazon.com/cdk/v2/guide/resources.html#resources-removal)]
    `);
  });

  test('falls back to logical ID when no construct path metadata exists', async () => {
    // GIVEN
    const stack = testStack({
      stackName: 'import-error-no-metadata',
      template: {
        Resources: {
          MyRoleF4B2B07F: {
            Type: 'AWS::IAM::Role',
          },
        },
      },
    });
    givenStackExists({ StackName: 'import-error-no-metadata' });
    fakeCfn.overrideChangeSetStatus = {
      status: 'FAILED',
      statusReason:
        'CloudFormation is attempting to import some resources because they already exist in your account. ' +
        "The resources must have the DeletionPolicy attribute set to 'Retain' or 'RetainExceptOnCreate' in the template for successful import. " +
        'The affected resources are MyRoleF4B2B07F ({RoleName=MyRole})',
      executionStatus: 'UNAVAILABLE',
    };

    // THEN - enhanced message with logical ID fallback (no construct path)
    await expect(
      testDeployStack({
        ...standardDeployStackArguments(stack),
        deploymentMethod: {
          method: 'change-set',
          importExistingResources: true,
        },
      }),
    ).rejects.toThrow(/import.*MyRoleF4B2B07F/);
  });
});

describe('revert-drift', () => {
  test('is disabled by default', async () => {
    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: {
        method: 'change-set',
      },
    });

    // THEN
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
      ...expect.anything,
      DeploymentMode: undefined,
    });
  });

  test('is added to the CreateChangeSetCommandInput', async () => {
    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: {
        method: 'change-set',
        revertDrift: true,
      },
    });

    // THEN
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
      ...expect.anything,
      DeploymentMode: 'REVERT_DRIFT',
    });
  });
});

test.each([
  // From a failed state, a --no-rollback is possible as long as there is not a replacement
  [StackStatus.UPDATE_FAILED, 'no-rollback', 'no-replacement', 'did-deploy-stack'],
  [StackStatus.UPDATE_FAILED, 'no-rollback', 'replacement', 'failpaused-need-rollback-first'],
  // Any combination of UPDATE_FAILED & rollback always requires a rollback first
  [StackStatus.UPDATE_FAILED, 'rollback', 'replacement', 'failpaused-need-rollback-first'],
  [StackStatus.UPDATE_FAILED, 'rollback', 'no-replacement', 'failpaused-need-rollback-first'],
  // From a stable state, any deployment containing a replacement requires a regular deployment (--rollback)
  [StackStatus.UPDATE_COMPLETE, 'no-rollback', 'replacement', 'replacement-requires-rollback'],
] satisfies Array<[StackStatus, 'rollback' | 'no-rollback', 'replacement' | 'no-replacement', string]>)(
  'no-rollback and replacement is disadvised: %s %s %s -> %s',
  async (stackStatus, rollback, replacement, expectedType) => {
    // GIVEN
    givenStackExists({
      // First call
      StackStatus: stackStatus,
    });
    givenTemplateIs(FAKE_STACK.template);
    givenChangeSetContainsReplacement(replacement === 'replacement');

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(FAKE_STACK),
      rollback: rollback === 'rollback',
      forceDeployment: true, // Bypass 'canSkipDeploy'
    });

    // THEN
    expect(result.type).toEqual(expectedType);
  },
);

test('assertIsSuccessfulDeployStackResult does what it says', () => {
  expect(() => assertIsSuccessfulDeployStackResult({ type: 'replacement-requires-rollback' })).toThrow();
});

describe('execute-change-set deployment method', () => {
  test('executes an existing change set without creating a new one', async () => {
    // GIVEN
    givenStackExists();
    givenChangeSetExists({
      Status: 'CREATE_COMPLETE',
      ChangeSetName: 'my-change-set',
      Changes: [{ Type: 'Resource' as const }],
    });

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: { method: 'execute-change-set', changeSetName: 'my-change-set' },
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateChangeSetCommand);
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
  });

  test('throws when change set is not in CREATE_COMPLETE status', async () => {
    // GIVEN
    givenStackExists();
    givenChangeSetExists({
      Status: 'FAILED',
      StatusReason: 'Something went wrong',
      ChangeSetName: 'my-change-set',
    });

    // THEN
    await expect(
      testDeployStack({
        ...standardDeployStackArguments(),
        deploymentMethod: { method: 'execute-change-set', changeSetName: 'my-change-set' },
      }),
    ).rejects.toThrow(/not ready for execution.*FAILED.*Something went wrong/);
  });

  test('throws when change set is in CREATE_PENDING status', async () => {
    // GIVEN
    givenStackExists();
    givenChangeSetExists({
      Status: 'CREATE_PENDING',
      ChangeSetName: 'my-change-set',
    });

    // THEN
    await expect(
      testDeployStack({
        ...standardDeployStackArguments(),
        deploymentMethod: { method: 'execute-change-set', changeSetName: 'my-change-set' },
      }),
    ).rejects.toThrow(/not ready for execution.*CREATE_PENDING/);
  });

  test('throws without reason when status reason is absent', async () => {
    // GIVEN
    givenStackExists();
    givenChangeSetExists({
      Status: 'DELETE_COMPLETE',
      ChangeSetName: 'my-change-set',
    });

    // THEN
    await expect(
      testDeployStack({
        ...standardDeployStackArguments(),
        deploymentMethod: { method: 'execute-change-set', changeSetName: 'my-change-set' },
      }),
    ).rejects.toThrow(/not ready for execution.*DELETE_COMPLETE(?!.*:)/);
  });

  test('returns replacement-requires-rollback when change set has replacement and rollback is disabled', async () => {
    // GIVEN
    givenStackExists();
    givenChangeSetExists({
      Status: 'CREATE_COMPLETE',
      ChangeSetName: 'my-change-set',
      Changes: [replacementChange()],
    });

    // WHEN
    const result = await advanceTime(
      testDeployStack({
        ...standardDeployStackArguments(),
        deploymentMethod: { method: 'execute-change-set', changeSetName: 'my-change-set' },
        rollback: false,
      }),
    );

    // THEN
    expect(result.type).toEqual('replacement-requires-rollback');
    expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
  });

  test('is never skipped by canSkipDeploy', async () => {
    // GIVEN - stack exists with identical template (would normally skip)
    givenStackExists();
    givenChangeSetExists({
      Status: 'CREATE_COMPLETE',
      ChangeSetName: 'my-change-set',
      Changes: [{ Type: 'Resource' as const }],
    });

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: { method: 'execute-change-set', changeSetName: 'my-change-set' },
    });

    // THEN - still executes despite identical template
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
  });
});

describe('change set returned with execute:false', () => {
  test('returns changeSet description when execute is false', async () => {
    // GIVEN
    givenStackExists();

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: { method: 'change-set', execute: false },
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    assertIsSuccessfulDeployStackResult(result);
    expect(result.noOp).toBe(false);
    expect(result.changeSet).toBeDefined();
    expect(result.changeSet?.Status).toEqual('CREATE_COMPLETE');
  });

  test('does not return changeSet when change set is empty', async () => {
    // GIVEN
    givenNoUpdatesAreToBePerformed();

    // WHEN
    const result = await advanceTime(
      testDeployStack({
        ...standardDeployStackArguments(),
        deploymentMethod: { method: 'change-set', execute: false },
      }),
    );

    // THEN
    assertIsSuccessfulDeployStackResult(result);
    expect(result.noOp).toBe(true);
    expect(result.changeSet).toBeUndefined();
  });
});

test('does not pass IncludeNestedStacks even for stacks with nested stacks', async () => {
  // Regression test: IncludeNestedStacks causes CloudFormation to report false
  // "duplicate Export names" errors when nested stacks use intrinsic functions
  // (like Fn::Join) in export names.
  await testDeployStack({
    ...standardDeployStackArguments(FAKE_STACK_WITH_NESTED_STACK),
  });

  const calls = mockCloudFormationClient.commandCalls(CreateChangeSetCommand);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0].args[0].input).not.toHaveProperty('IncludeNestedStacks');
});

/**
 * Set up the mocks so that it looks like the stack exists to start with
 *
 * The last element of this array will be continuously repeated.
 */
function givenStackExists(overrides: Partial<Stack> & { StackName?: string } = {}) {
  const stackName = overrides.StackName ?? 'withouterrors';
  fakeCfn.createStackSync({
    ...baseResponse,
    StackName: stackName,
    ...overrides,
  });
  // Set the template to match the default FAKE_STACK template unless the test
  // explicitly sets it via givenTemplateIs
  fakeCfn.accessStack(stackName).template = defaultStartTemplate();
}

function givenChangeSetExists(options: Partial<DescribeChangeSetOutput> = {}) {
  const stack = fakeCfn.firstStack();

  fakeCfn.createChangeSetSync({
    StackName: stack.name,
    ChangeSetName: 'change-set',
    ...options,
  });
}

function givenCurrentChangeSetIsEmpty() {
  givenChangeSetExists({
    Status: ChangeSetStatus.FAILED,
    StatusReason: 'No updates are to be performed',
  });
}

function givenTemplateIs(template: any) {
  const stack = fakeCfn.firstStack();
  stack.template = template;
}

function givenNoUpdatesAreToBePerformed() {
  givenStackExists();
  givenTemplateIs(defaultTargetTemplate());
}

function replacementChange(): Change {
  return {
    Type: 'Resource',
    ResourceChange: {
      PolicyAction: 'ReplaceAndDelete',
      Action: 'Modify',
      LogicalResourceId: 'Queue4A7E3555',
      PhysicalResourceId: 'https://sqs.eu-west-1.amazonaws.com/111111111111/Queue4A7E3555-P9C8nK3uv8v6.fifo',
      ResourceType: 'AWS::SQS::Queue',
      Replacement: 'True',
      Scope: ['Properties'],
      Details: [
        {
          Target: {
            Attribute: 'Properties',
            Name: 'FifoQueue',
            RequiresRecreation: 'Always',
          },
          Evaluation: 'Static',
          ChangeSource: 'DirectModification',
        },
      ],
    },
  };
}

function updateChange(): Change {
  return {
    Type: 'Resource',
    ResourceChange: {
      Action: 'Modify',
      LogicalResourceId: 'Queue4A7E3555',
      ResourceType: 'AWS::SQS::Queue',
      Replacement: 'False',
    },
  };
}

function givenChangeSetContainsReplacement(replacement: boolean) {
  fakeCfn.overrideChangeSetChanges = replacement ? [replacementChange()] : [updateChange()];
}

function defaultStartTemplate() {
  return {
    Description: 'Default start template in deploy-stack.test.ts',
    Resources: {
      MyResource: {
        Type: 'Test::Resource::Type',
        Properties: {
          Foo: 'Foo',
        },
      },
    },
  };
}

/**
 * The default template that most stacks will update to
 */
function defaultTargetTemplate() {
  return {
    Description: 'Default start template in deploy-stack.test.ts',
    Resources: {
      MyResource: {
        Type: 'Test::Resource::Type',
        Properties: {
          Bar: 'Bar',
        },
      },
    },
  };
}
