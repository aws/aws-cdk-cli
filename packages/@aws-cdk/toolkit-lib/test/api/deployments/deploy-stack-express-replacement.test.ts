import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import type { Change, CreateChangeSetCommandInput, DeploymentConfig, Stack } from '@aws-sdk/client-cloudformation';
import {
  CreateChangeSetCommand,
  DescribeChangeSetCommand,
  ExecuteChangeSetCommand,
  StackStatus,
  UpdateStackCommand,
} from '@aws-sdk/client-cloudformation';
import type { DeployStackOptions as DeployStackApiOptions } from '../../../lib/api/deployments/deploy-stack';
import { CFN_REPLACEMENT_WITH_ROLLBACK_DISABLED_REASON, deployStack } from '../../../lib/api/deployments/deploy-stack';
import { CloudFormationStackDiagnoser } from '../../../lib/api/diagnosing/stack-diagnoser';
import { NoBootstrapStackEnvironmentResources } from '../../../lib/api/environment';
import { IO } from '../../../lib/api/io/private';
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

const W5903 = IO.CDK_TOOLKIT_W5903.code;

let ioHost = new TestIoHost('debug', true);
let ioHelper = ioHost.asHelper('deploy');

function testDeployStack(options: DeployStackApiOptions) {
  return advanceTime(deployStack(options, ioHelper));
}

jest.mock('../../../lib/api/deployments/checks', () => ({
  determineAllowCrossAccountAssetPublishing: jest.fn().mockResolvedValue(true),
}));

function startTemplate() {
  return {
    Description: 'Start template in deploy-stack-express-replacement.test.ts',
    Resources: {
      MyResource: {
        Type: 'Test::Resource::Type',
        Properties: { Foo: 'Foo' },
      },
    },
  };
}

function targetTemplate() {
  return {
    Description: 'Start template in deploy-stack-express-replacement.test.ts',
    Resources: {
      MyResource: {
        Type: 'Test::Resource::Type',
        Properties: { Bar: 'Bar' },
      },
    },
  };
}

function templateRejectingReplacement() {
  return {
    Resources: {
      MyResource: {
        Type: 'Test::Resource::Type',
        Properties: {
          Bar: 'Bar',
          Fail: true,
          FailReason: `${CFN_REPLACEMENT_WITH_ROLLBACK_DISABLED_REASON}.`,
        },
      },
    },
  };
}

const FAKE_STACK = testStack({
  stackName: 'withouterrors',
  template: targetTemplate(),
});

const FAKE_STACK_REJECTING_REPLACEMENT = testStack({
  stackName: 'withouterrors',
  template: templateRejectingReplacement(),
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

  ioHost = new TestIoHost('debug', true);
  ioHelper = ioHost.asHelper('deploy');

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

function givenStackExists(overrides: Partial<Stack> & { StackName?: string } = {}) {
  const stackName = overrides.StackName ?? 'withouterrors';
  fakeCfn.createStackSync({
    ...baseResponse,
    StackName: stackName,
    ...overrides,
  });
  fakeCfn.accessStack(stackName).template = startTemplate();
}

function policyActionReplacementChange(logicalId = 'TaskDef54694570'): Change {
  return {
    Type: 'Resource',
    ResourceChange: {
      PolicyAction: 'ReplaceAndDelete',
      Action: 'Modify',
      LogicalResourceId: logicalId,
      ResourceType: 'AWS::ECS::TaskDefinition',
      Replacement: 'True',
      Scope: ['Properties'],
      Details: [
        {
          Target: { Attribute: 'Properties', Name: 'Memory', RequiresRecreation: 'Always' },
          Evaluation: 'Static',
          ChangeSource: 'DirectModification',
        },
      ],
    },
  };
}

function updateChange(logicalId = 'Queue4A7E3555'): Change {
  return {
    Type: 'Resource',
    ResourceChange: {
      Action: 'Modify',
      LogicalResourceId: logicalId,
      ResourceType: 'AWS::SQS::Queue',
      Replacement: 'False',
    },
  };
}

function conditionalChange(logicalId = 'CDKMetadata'): Change {
  return {
    Type: 'Resource',
    ResourceChange: {
      Action: 'Modify',
      LogicalResourceId: logicalId,
      ResourceType: 'AWS::CDK::Metadata',
      Replacement: 'Conditional',
      Scope: ['Properties'],
      Details: [
        {
          Target: { Attribute: 'Properties', Name: 'Analytics', RequiresRecreation: 'Conditionally' },
          Evaluation: 'Static',
          ChangeSource: 'DirectModification',
        },
      ],
    },
  };
}

function replacementOnlyChange(logicalId = 'TaskDef54694570'): Change {
  return {
    Type: 'Resource',
    ResourceChange: {
      Action: 'Modify',
      LogicalResourceId: logicalId,
      ResourceType: 'AWS::ECS::TaskDefinition',
      Replacement: 'True',
      Scope: ['Properties'],
    },
  };
}

function failOnAnyStackMutation() {
  mockCloudFormationClient.on(ExecuteChangeSetCommand).callsFake(() => {
    throw new Error('ExecuteChangeSet must not be called when the replacement guard trips');
  });
  mockCloudFormationClient.on(UpdateStackCommand).callsFake(() => {
    throw new Error('UpdateStack must not be called when the replacement guard trips');
  });
}

function expectNoStackMutation() {
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(UpdateStackCommand);
}

function expectUnwedgeBeforeRollbackSuggestion(message: string) {
  const state = message.indexOf('in a failed state');
  const step1 = message.indexOf('Revert your change');
  const step2 = message.indexOf('cdk deploy --express --method=direct');
  const suggestion = message.indexOf('Re-apply your change and deploy it with');
  const firstRollbackMention = message.indexOf('cdk deploy --express --rollback');

  expect(state).toBeGreaterThanOrEqual(0);
  expect(firstRollbackMention).toBeGreaterThan(state);
  expect(step1).toBeGreaterThan(state);
  expect(step2).toBeGreaterThan(step1);
  expect(suggestion).toBeGreaterThan(step2);
}

function expectRecreateGuidance(message: string) {
  expect(message).toMatch(/no previous configuration to replay/);
  expect(message).toMatch(/Delete the stack and deploy again/);
  expect(message).not.toMatch(/Revert your change/);
  expect(message).not.toMatch(/Re-apply your change and deploy it with/);
  expect(message).not.toMatch(/--method=direct/);
}

describe('change set path, replacement reported as policy action with Replacement=True', () => {
  const replacementChange = policyActionReplacementChange;
  test('express with rollback disabled is gated before ExecuteChangeSet', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    fakeCfn.overrideChangeSetChanges = [replacementChange()];
    failOnAnyStackMutation();

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      express: true,
      forceDeployment: true,
    });

    // THEN
    expect(result.type).toEqual('replacement-requires-rollback');
    expectNoStackMutation();

    ioHost.expectMessage({
      level: 'warn',
      code: W5903,
      containing: 'does not support while rollback is disabled',
    });
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'unless you ask for it with --rollback' });

    expect(ioHost.messagesWithCode(W5903)[0].message).not.toContain('To recover');
    expect(ioHost.messagesWithCode(W5903)[0].message).not.toContain('cdk deploy --express --rollback');

    expect(ioHost.messagesWithCode(W5903)[0].data).toEqual(expect.objectContaining({
      stackName: 'withouterrors',
      detectedBy: 'change-set',
      replacements: [expect.objectContaining({
        logicalId: 'TaskDef54694570',
        resourceType: 'AWS::ECS::TaskDefinition',
      })],
    }));
  });

  test('express with rollback enabled deploys the replacement with DisableRollback: false', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    fakeCfn.overrideChangeSetChanges = [replacementChange()];

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      express: true,
      rollback: true,
      forceDeployment: true,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
      ...expect.anything,
      DeploymentConfig: {
        Mode: 'EXPRESS',
        DisableRollback: false,
      },
    } as CreateChangeSetCommandInput);
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
  });

  test('non-express --no-rollback is gated, without the express-specific guidance', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    fakeCfn.overrideChangeSetChanges = [replacementChange()];
    failOnAnyStackMutation();

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      rollback: false,
      forceDeployment: true,
    });

    // THEN
    expect(result.type).toEqual('replacement-requires-rollback');
    expectNoStackMutation();
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
  });

  test('non-express paused fail state still requires a rollback first', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_FAILED });
    fakeCfn.overrideChangeSetChanges = [replacementChange()];
    failOnAnyStackMutation();

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      rollback: false,
      forceDeployment: true,
    });

    // THEN
    expect(result.type).toEqual('failpaused-need-rollback-first');
    expectNoStackMutation();
  });

  test('express from an already-failed stack fails terminally instead of offering a doomed retry', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_FAILED });
    fakeCfn.overrideChangeSetChanges = [replacementChange()];
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      express: true,
      forceDeployment: true,
    });

    // THEN
    await expect(deployment).rejects.toThrow(/in a failed state/);
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ReplacementRequiresUnwedge' }));
    await expect(deployment).rejects.toThrow(/Revert your change/);
    await expect(deployment).rejects.toThrow(/cdk deploy --express --method=direct/);
    expectUnwedgeBeforeRollbackSuggestion(await deployment.then(() => '', (e) => e.message));
    expectNoStackMutation();

    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'Revert your change' });
  });
});

describe('change set path', () => {
  test('express with rollback disabled and no replacement deploys unchanged', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    fakeCfn.overrideChangeSetChanges = [updateChange()];

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      express: true,
      forceDeployment: true,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
      ...expect.anything,
      DeploymentConfig: { Mode: 'EXPRESS' },
    } as CreateChangeSetCommandInput);
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
  });

  test('a replacement reported without a policy action is not gated up front (#1971)', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    fakeCfn.overrideChangeSetChanges = [replacementOnlyChange()];

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      express: true,
      forceDeployment: true,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
  });

  test('a replacement on the second page of DescribeChangeSet results is still gated', async () => {
    // GIVEN
    fakeCfn.reset({ pageSize: 1 });
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    fakeCfn.overrideChangeSetChanges = [updateChange('First'), policyActionReplacementChange('Second')];
    failOnAnyStackMutation();

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      express: true,
      forceDeployment: true,
    });

    // THEN
    expect(result.type).toEqual('replacement-requires-rollback');
    expectNoStackMutation();
    expect(mockCloudFormationClient.commandCalls(DescribeChangeSetCommand).length).toBeGreaterThan(1);
  });

  test('a plain deployment with a replacement deploys unchanged', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    fakeCfn.overrideChangeSetChanges = [policyActionReplacementChange()];

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      forceDeployment: true,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
  });

  test('a replacement the change set did not declare is still routed after CloudFormation rejects it', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    fakeCfn.overrideChangeSetChanges = [conditionalChange()];

    // WHEN
    await expect(testDeployStack({
      ...standardDeployStackArguments(FAKE_STACK_REJECTING_REPLACEMENT),
      express: true,
      forceDeployment: true,
    })).rejects.toThrow(CFN_REPLACEMENT_WITH_ROLLBACK_DISABLED_REASON);

    // THEN
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'CloudFormation refused a replacement' });
    expect(ioHost.messagesWithCode(W5903)[0].data).toEqual(expect.objectContaining({
      detectedBy: 'service-error',
    }));
  });
});

describe('REGRESSION aws/aws-cdk-cli#1931: the express replacement guard must not be removed or rescoped', () => {
  test.each([
    ['rollback not specified (express disables rollback by default)', undefined],
    ['rollback explicitly disabled', false],
  ] satisfies Array<[string, boolean | undefined]>)('%s', async (_name, rollback) => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    fakeCfn.overrideChangeSetChanges = [policyActionReplacementChange()];
    failOnAnyStackMutation();

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      express: true,
      rollback,
      forceDeployment: true,
    });

    // THEN
    expect(result).toEqual({ type: 'replacement-requires-rollback' });
    expectNoStackMutation();
    expect(fakeCfn.accessStack('withouterrors').status).toEqual(StackStatus.UPDATE_COMPLETE);
  });

  test('rollback: true is the one express case that is allowed through', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    fakeCfn.overrideChangeSetChanges = [policyActionReplacementChange()];

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      express: true,
      rollback: true,
      forceDeployment: true,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
  });
});

describe('direct path', () => {
  test('a non-express --no-rollback rejection is not routed towards Express Mode', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });

    // WHEN
    await expect(testDeployStack({
      ...standardDeployStackArguments(FAKE_STACK_REJECTING_REPLACEMENT),
      deploymentMethod: { method: 'direct' },
      rollback: false,
      forceDeployment: true,
    })).rejects.toThrow(CFN_REPLACEMENT_WITH_ROLLBACK_DISABLED_REASON);

    // THEN
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
  });

  test('a rejected replacement strands the stack, and the user is routed to --express --rollback', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });

    // WHEN
    await expect(testDeployStack({
      ...standardDeployStackArguments(FAKE_STACK_REJECTING_REPLACEMENT),
      deploymentMethod: { method: 'direct' },
      express: true,
      forceDeployment: true,
    })).rejects.toThrow(CFN_REPLACEMENT_WITH_ROLLBACK_DISABLED_REASON);

    // THEN
    expect(fakeCfn.accessStack('withouterrors').status).toEqual(StackStatus.UPDATE_FAILED);

    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'CloudFormation refused a replacement' });
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'Revert your change' });
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'cdk deploy --express --method=direct' });
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'cdk deploy --express --rollback' });
    expectUnwedgeBeforeRollbackSuggestion(ioHost.messagesWithCode(W5903)[0].message);
    expect(ioHost.messagesWithCode(W5903)[0].data).toEqual(expect.objectContaining({
      stackName: 'withouterrors',
      detectedBy: 'service-error',
      replacements: [expect.objectContaining({ logicalId: 'MyResource' })],
    }));
  });

  test('with rollback enabled the stack rolls back and no guidance is emitted', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });

    // WHEN
    await expect(testDeployStack({
      ...standardDeployStackArguments(FAKE_STACK_REJECTING_REPLACEMENT),
      deploymentMethod: { method: 'direct' },
      express: true,
      rollback: true,
      forceDeployment: true,
    })).rejects.toThrow(CFN_REPLACEMENT_WITH_ROLLBACK_DISABLED_REASON);

    // THEN
    expect(fakeCfn.accessStack('withouterrors').status).toEqual(StackStatus.UPDATE_ROLLBACK_COMPLETE);
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
  });

  test('a no-op replay against a hand-seeded stranded stack is not blocked', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_FAILED });
    fakeCfn.accessStack('withouterrors').template = targetTemplate();

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: { method: 'direct' },
      express: true,
      forceDeployment: true,
    });

    // THEN
    expect(result).toEqual(expect.objectContaining({ type: 'did-deploy-stack', noOp: true }));
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
  });

  test('a failure that does not mention the rejection logs what it did see', async () => {
    // GIVEN
    const otherFailure = testStack({
      stackName: 'withouterrors',
      template: {
        Resources: {
          MyResource: {
            Type: 'Test::Resource::Type',
            Properties: { Bar: 'Bar', Fail: true, FailReason: 'Some other service error' },
          },
        },
      },
    });
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });

    // WHEN
    await expect(testDeployStack({
      ...standardDeployStackArguments(otherFailure),
      deploymentMethod: { method: 'direct' },
      express: true,
      forceDeployment: true,
    })).rejects.toThrow('Some other service error');

    // THEN
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
    ioHost.expectMessage({ level: 'debug', containing: 'no reported error mentioned' });
    ioHost.expectMessage({ level: 'debug', containing: 'Some other service error' });
  });
});

describe('executing a change set created by an earlier invocation', () => {
  function givenExpressChangeSetExists(opts: { rollbackDisabled: boolean; changes: Change[] }) {
    fakeCfn.createChangeSetSync({
      StackName: 'withouterrors',
      ChangeSetName: 'prepared',
      Status: 'CREATE_COMPLETE',
      ExecutionStatus: 'AVAILABLE',
      Changes: opts.changes,
      DeploymentConfig: opts.rollbackDisabled
        ? { Mode: 'EXPRESS' }
        : { Mode: 'EXPRESS', DisableRollback: false },
    });
  }

  const executePrepared: Partial<DeployStackApiOptions> = {
    deploymentMethod: { method: 'execute-change-set', changeSetName: 'prepared' },
    forceDeployment: true,
  };

  test('a rollback-disabled change set with no replacement is executed, with the ignored flag reported', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: true, changes: [updateChange()] });

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
      rollback: true,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
    ioHost.expectMessage({ level: 'warn', containing: 'created with rollback disabled' });
  });

  test('a rollback-disabled change set containing a replacement is never executed', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: true, changes: [policyActionReplacementChange()] });
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
      rollback: true,
    });

    // THEN
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ReplacementRequiresRecreateChangeSet' }));
    await expect(deployment).rejects.toThrow(/Create a new change set with rollback enabled/);
    expectNoStackMutation();
    expect(fakeCfn.accessStack('withouterrors').status).toEqual(StackStatus.UPDATE_COMPLETE);
  });

  test('omitting --express does not make a persisted Express change set look safe', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: true, changes: [policyActionReplacementChange()] });
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
    });

    // THEN
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ReplacementRequiresRecreateChangeSet' }));
    expectNoStackMutation();
  });

  test('the opposite mismatch is reported too: rollback-enabled change set executed as rollback-disabled', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: false, changes: [updateChange()] });

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    ioHost.expectMessage({ level: 'warn', containing: 'created with rollback enabled' });
  });

  test('a matching rollback-disabled change set with a replacement is terminal, not offered a retry', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: true, changes: [policyActionReplacementChange()] });
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ReplacementRequiresRecreateChangeSet' }));
    expectNoStackMutation();
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'does not support while rollback is disabled' });
  });

  function givenChangeSetExists(opts: { deploymentConfig?: DeploymentConfig; changes: Change[] }) {
    fakeCfn.createChangeSetSync({
      StackName: 'withouterrors',
      ChangeSetName: 'prepared',
      Status: 'CREATE_COMPLETE',
      ExecutionStatus: 'AVAILABLE',
      Changes: opts.changes,
      DeploymentConfig: opts.deploymentConfig,
    });
  }

  function givenNestedChangeSetExists(opts: { rollbackDisabled: boolean; childChanges: Change[] }) {
    const childStackName = 'withouterrors-NestedChild-ABC123';
    const deploymentConfig: DeploymentConfig = opts.rollbackDisabled
      ? { Mode: 'EXPRESS' }
      : { Mode: 'EXPRESS', DisableRollback: false };

    fakeCfn.createStackSync({ StackName: childStackName, StackStatus: StackStatus.UPDATE_COMPLETE });
    const child = fakeCfn.createChangeSetSync({
      StackName: childStackName,
      ChangeSetName: 'prepared-nested-child',
      Status: 'CREATE_COMPLETE',
      ExecutionStatus: 'AVAILABLE',
      Changes: opts.childChanges,
      DeploymentConfig: deploymentConfig,
    });

    givenChangeSetExists({
      deploymentConfig,
      changes: [{
        Type: 'Resource',
        ResourceChange: {
          Action: 'Modify',
          LogicalResourceId: 'NestedChild',
          PhysicalResourceId: childStackName,
          ResourceType: 'AWS::CloudFormation::Stack',
          Replacement: 'False',
          ChangeSetId: child.Id,
        },
      }],
    });

    return { childStackName, childChangeSetId: child.Id };
  }

  test('a replacement inside a nested stack is gated, not executed', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenNestedChangeSetExists({ rollbackDisabled: true, childChanges: [policyActionReplacementChange()] });
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ReplacementRequiresRecreateChangeSet' }));
    expectNoStackMutation();
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'does not support while rollback is disabled' });
  });

  test('a nested stack with no replacement executes normally', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenNestedChangeSetExists({ rollbackDisabled: true, childChanges: [updateChange()] });

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
  });

  function givenRootWithNestedStackChange(nested: Record<string, unknown>) {
    givenChangeSetExists({
      deploymentConfig: { Mode: 'EXPRESS' },
      changes: [{
        Type: 'Resource',
        ResourceChange: {
          LogicalResourceId: 'NestedChild',
          ResourceType: 'AWS::CloudFormation::Stack',
          ...nested,
        },
      }],
    });
  }

  function givenNestedChain(levels: number, deepestChanges: Change[]) {
    const deploymentConfig: DeploymentConfig = { Mode: 'EXPRESS' };
    let child: { id: string; stackName: string } | undefined;

    for (let i = levels; i >= 1; i--) {
      const stackName = `withouterrors-Nested${i}`;
      fakeCfn.createStackSync({ StackName: stackName, StackStatus: StackStatus.UPDATE_COMPLETE });
      const changes: Change[] = child
        ? [{
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: `Nested${i + 1}`,
            PhysicalResourceId: child.stackName,
            ResourceType: 'AWS::CloudFormation::Stack',
            Replacement: 'False',
            ChangeSetId: child.id,
          },
        }]
        : deepestChanges;

      const cs = fakeCfn.createChangeSetSync({
        StackName: stackName,
        ChangeSetName: `prepared-nested-${i}`,
        Status: 'CREATE_COMPLETE',
        ExecutionStatus: 'AVAILABLE',
        Changes: changes,
        DeploymentConfig: deploymentConfig,
      });
      child = { id: cs.Id!, stackName };
    }

    givenRootWithNestedStackChange({
      Action: 'Modify',
      LogicalResourceId: 'Nested1',
      PhysicalResourceId: child!.stackName,
      Replacement: 'False',
      ChangeSetId: child!.id,
    });
  }

  async function expectBlockedAsIncomplete(deployment: Promise<unknown>) {
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'NestedChangeSetInspectionIncomplete' }));
    expectNoStackMutation();
  }

  test('a nested stack change carrying no child change set blocks instead of assuming no replacement', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenRootWithNestedStackChange({ Action: 'Modify', PhysicalResourceId: 'some-child', Replacement: 'False' });
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    await expectBlockedAsIncomplete(deployment);
  });

  test('a REMOVED nested stack legitimately has no child change set and does not block', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenRootWithNestedStackChange({ Action: 'Remove', PhysicalResourceId: 'some-child' });

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
  });

  test('a malformed or not-found child change set blocks instead of assuming no replacement', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenRootWithNestedStackChange({
      Action: 'Modify',
      PhysicalResourceId: 'some-child',
      Replacement: 'False',
      ChangeSetId: 'malformed-or-not-found',
    });
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    await expectBlockedAsIncomplete(deployment);
  });

  test('a child DescribeChangeSet failure blocks instead of assuming no replacement', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    const { childChangeSetId } = givenNestedChangeSetExists({
      rollbackDisabled: true,
      childChanges: [policyActionReplacementChange()],
    });
    mockCloudFormationClient
      .on(DescribeChangeSetCommand, { ChangeSetName: childChangeSetId })
      .rejects(new Error('Rate exceeded'));
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    await expectBlockedAsIncomplete(deployment);
  });

  test('a child change set in CREATE_FAILED blocks instead of reading its absent changes as empty', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    const childStackName = 'withouterrors-NestedChild-FAILED';
    fakeCfn.createStackSync({ StackName: childStackName, StackStatus: StackStatus.UPDATE_COMPLETE });
    const child = fakeCfn.createChangeSetSync({
      StackName: childStackName,
      ChangeSetName: 'prepared-nested-failed',
      Status: 'CREATE_FAILED',
      StatusReason: 'Insufficient permissions to describe the nested template',
      ExecutionStatus: 'UNAVAILABLE',
      DeploymentConfig: { Mode: 'EXPRESS' },
    });
    givenRootWithNestedStackChange({
      Action: 'Modify',
      PhysicalResourceId: childStackName,
      Replacement: 'False',
      ChangeSetId: child.Id,
    });
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    await expectBlockedAsIncomplete(deployment);
  });

  test('a hierarchy deeper than the traversal cap blocks instead of skipping the unread levels', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenNestedChain(11, [policyActionReplacementChange()]);
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    await expectBlockedAsIncomplete(deployment);
  });

  test('a cycle terminates and still reports the replacement it found', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    const childStackName = 'withouterrors-NestedCycle';
    fakeCfn.createStackSync({ StackName: childStackName, StackStatus: StackStatus.UPDATE_COMPLETE });
    const root = fakeCfn.createChangeSetSync({
      StackName: 'withouterrors',
      ChangeSetName: 'prepared',
      Status: 'CREATE_COMPLETE',
      ExecutionStatus: 'AVAILABLE',
      DeploymentConfig: { Mode: 'EXPRESS' },
      Changes: [{
        Type: 'Resource',
        ResourceChange: {
          Action: 'Modify',
          LogicalResourceId: 'NestedCycle',
          PhysicalResourceId: childStackName,
          ResourceType: 'AWS::CloudFormation::Stack',
          Replacement: 'False',
          ChangeSetId: 'cycle-child',
        },
      }],
    });
    fakeCfn.createChangeSetSync({
      StackName: childStackName,
      ChangeSetName: 'cycle-child',
      Status: 'CREATE_COMPLETE',
      ExecutionStatus: 'AVAILABLE',
      DeploymentConfig: { Mode: 'EXPRESS' },
      Changes: [
        policyActionReplacementChange(),
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'BackToRoot',
            PhysicalResourceId: 'withouterrors',
            ResourceType: 'AWS::CloudFormation::Stack',
            Replacement: 'False',
            ChangeSetId: root.Id,
          },
        },
      ],
    });
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ReplacementRequiresRecreateChangeSet' }));
    expectNoStackMutation();
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'does not support while rollback is disabled' });
  });

  const POLICY_MATRIX = [
    [true, { express: true, rollback: true }, 'reported'],
    [true, { express: true }, 'silent'],
    [true, { express: true, rollback: false }, 'silent'],
    [true, { rollback: true }, 'reported'],
    [true, {}, 'reported'],
    [true, { rollback: false }, 'silent'],
    [false, { express: true, rollback: true }, 'silent'],
    [false, { express: true }, 'reported'],
    [false, { express: true, rollback: false }, 'reported'],
    [false, { rollback: true }, 'silent'],
    [false, {}, 'silent'],
    [false, { rollback: false }, 'reported'],
  ] as Array<[boolean, Partial<DeployStackApiOptions>, 'silent' | 'reported']>;

  test('the policy matrix covers every express/rollback/persisted combination', () => {
    expect(POLICY_MATRIX).toHaveLength(12);
  });

  test('no DisableRollback is sent when the change set already pins the policy', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: false, changes: [updateChange()] });

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
      rollback: false,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
    const sent = mockCloudFormationClient.commandCalls(ExecuteChangeSetCommand)[0].args[0].input;
    expect(sent).not.toHaveProperty('DisableRollback');
  });

  test('DisableRollback is still sent when the change set records no policy', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenChangeSetExists({ deploymentConfig: { Mode: 'STANDARD' }, changes: [updateChange()] });

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      rollback: false,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    const sent = mockCloudFormationClient.commandCalls(ExecuteChangeSetCommand)[0].args[0].input;
    expect(sent.DisableRollback).toEqual(true);
  });

  describe.each(POLICY_MATRIX)(
    'persisted rollbackDisabled=%s executed with %j',
    (persistedRollbackDisabled, flags, expected) => {
      test(`is ${expected}`, async () => {
        // GIVEN
        givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
        givenExpressChangeSetExists({ rollbackDisabled: persistedRollbackDisabled, changes: [updateChange()] });

        // WHEN
        const result = await testDeployStack({
          ...standardDeployStackArguments(),
          ...executePrepared,
          ...flags,
        });

        // THEN
        expect(result.type).toEqual('did-deploy-stack');
        expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);

        const warnings = ioHost.notifySpy.mock.calls
          .map((c) => c[0])
          .filter((m: any) => m.level === 'warn' && /was created with rollback/.test(m.message));
        expect(warnings).toHaveLength(expected === 'reported' ? 1 : 0);
      });
    },
  );

  test('--express does not imply rollback-disabled for a change set that is not Express', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenChangeSetExists({ deploymentConfig: { Mode: 'STANDARD' }, changes: [policyActionReplacementChange()] });

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
  });

  test('a failed initial create is not told to replay a configuration that never existed', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.CREATE_FAILED });
    fakeCfn.overrideChangeSetChanges = [policyActionReplacementChange()];
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      express: true,
      forceDeployment: true,
    });

    // THEN
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ReplacementRequiresUnwedge' }));
    await expect(deployment).rejects.toThrow(/no previous configuration to replay/);
    await expect(deployment).rejects.toThrow(/Delete the stack and deploy again/);
    await expect(deployment).rejects.not.toThrow(/Revert your change/);
    expectRecreateGuidance(await deployment.then(() => '', (e) => e.message));
    expectNoStackMutation();
  });

  test('a matching change set without a replacement executes normally', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: true, changes: [updateChange()] });

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
  });
});
