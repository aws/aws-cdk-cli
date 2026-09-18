import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import type { Change, CreateChangeSetCommandInput, Stack } from '@aws-sdk/client-cloudformation';
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

const W5903 = 'CDK_TOOLKIT_W5903';

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

/**
 * A template whose update fails the way CloudFormation fails a replacement on a rollback-disabled stack
 */
function templateRejectingReplacement() {
  return {
    Resources: {
      MyResource: {
        Type: 'Test::Resource::Type',
        Properties: {
          Bar: 'Bar',
          Fail: true,
          // CloudFormation appends a period; we match on a substring, so keep the fixture faithful to the service.
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

/**
 * The shape CloudFormation actually emitted for the change in aws/aws-cdk-cli#1931.
 *
 * A replacement of a resource with a default deletion policy carries BOTH a `ReplaceAndDelete` policy action and
 * `Replacement: 'True'` - verified against a real `DescribeChangeSet` response for the reproduction stack.
 */
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

/**
 * `CDKMetadata` reports `Replacement: 'Conditional'` on essentially every real CDK deployment (its `Analytics`
 * property is `RequiresRecreation: 'Conditionally'`), so `Conditional` must never be treated as a replacement.
 */
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

/**
 * The change shapes the guard must recognise.
 */
const REPLACEMENT_FIXTURES: Array<[string, (logicalId?: string) => Change]> = [
  ['policy action with Replacement=True', policyActionReplacementChange],
];

/**
 * Make any attempt to actually mutate the stack a hard test failure.
 *
 * The point of the guard is that we stop *before* submitting the update, so a test that only asserted on the returned
 * result type would still pass if the deployment happened anyway.
 */
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

describe.each(REPLACEMENT_FIXTURES)('change set path, replacement reported as %s', (_shape, replacementChange) => {
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

    // From a healthy stack the caller is about to offer to retry with rollback enabled, so we must NOT tell the user
    // to run a deployment themselves, and the recovery runbook does not apply yet.
    expect(ioHost.messagesWithCode(W5903)[0].message).not.toContain('To recover');
    expect(ioHost.messagesWithCode(W5903)[0].message).not.toContain('cdk deploy --express --rollback');

    // Nothing was submitted, so we know this from the change set rather than from a failure
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

    // THEN - this is the route users are sent to, so pin both halves of it
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

  // Verified against CloudFormation: retrying with rollback enabled from a stack that is already in a failed state is
  // answered with "This stack is currently in a non-terminal [UPDATE_FAILED] state", so telling the user to deploy with
  // `--rollback` and nothing else would send them into a second failure. The previous configuration must be replayed
  // first, so an already-failed stack gets the recovery steps up front.
  test('express from an already-failed stack explains that it has to be unwedged first', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_FAILED });
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
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'in a failed state' });
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'Revert your change' });
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'cdk deploy --express --method=direct' });
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

  test('a replacement on the second page of DescribeChangeSet results is still gated', async () => {
    // GIVEN - one change per page, with the replacement on page two
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

  // This is why the routing hook lives in `monitorDeployment` rather than in `directDeployment`: a change set can
  // contain a replacement the pre-flight check cannot see (CloudFormation reports `Conditional`), so the change set
  // path needs the after-the-fact guidance too.
  test('a replacement the change set did not declare is still routed after CloudFormation rejects it', async () => {
    // GIVEN - the change set only reports a Conditional change, so the gate does not fire...
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    fakeCfn.overrideChangeSetChanges = [conditionalChange()];

    // WHEN - ...but executing it fails the way CloudFormation fails a rejected replacement
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

/**
 * The express replacement guard has been deleted once and restructured once without the suite noticing:
 *
 * - aws/aws-cdk-cli#1745 removed `expressNoRollback` from the guard condition and relaxed the test that covered it,
 *   which shipped the regression in CLI 2.1133.0.
 * - aws/aws-cdk-cli#1785 then restructured what was left into `if (!this.options.express) { ... }`.
 * - aws/aws-cdk-cli#1931 is the resulting SEV: `cdk deploy --express` submits a replacement while CloudFormation has
 *   rollback disabled, CloudFormation rejects it, and the stack is stranded in UPDATE_FAILED.
 *
 * These cases exist to fail loudly if the guard is removed again, or if its scope is changed so that express
 * deployments stop consulting it. They deliberately assert the *negative* (nothing was submitted to CloudFormation)
 * rather than that a message was printed.
 */
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

    // THEN - the result type `cdk-toolkit` turns into a confirm-and-retry-with-rollback prompt
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

    // THEN - this is the SEV: rollback is disabled server-side, so the stack cannot roll itself back
    expect(fakeCfn.accessStack('withouterrors').status).toEqual(StackStatus.UPDATE_FAILED);

    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'CloudFormation refused a replacement' });
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'Revert your change' });
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'cdk deploy --express --method=direct' });
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'cdk deploy --express --rollback' });
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

    // THEN - a genuinely failing replacement under `--express --rollback` recovers on its own
    expect(fakeCfn.accessStack('withouterrors').status).toEqual(StackStatus.UPDATE_ROLLBACK_COMPLETE);
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
  });

  // `cdk deploy --express --method=direct` with the previous configuration is the documented way to unwedge a stack
  // that is already stranded in UPDATE_FAILED, so it must stay a plain no-op and must never be refused up front.
  test('an empty-diff replay from a stranded stack is not blocked', async () => {
    // GIVEN - the stranded stack already has the template we are about to deploy
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

  // CloudFormation owns the prose we match on and has a change landing around 2026-11-15. When it stops matching we
  // want a breadcrumb in the debug log rather than silence.
  test('a failure that does not mention the rejection logs what it did see', async () => {
    // GIVEN - a failing update whose reason is not the replacement rejection
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
