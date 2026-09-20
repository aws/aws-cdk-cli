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
 * A replacement CloudFormation reports only via `Replacement: 'True'`, with no policy action attached.
 *
 * Not gated up front today - see the negative test below and #1971.
 */
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

  // Verified against CloudFormation: a stack already in a failed state cannot be updated with rollback enabled either -
  // it answers "This stack is currently in a non-terminal [UPDATE_FAILED] state". Returning
  // `replacement-requires-rollback` would make the toolkit offer that deployment, and since the confirmation defaults
  // to yes, a non-interactive caller would run it and fail again. So this must be a terminal error, not a prompt.
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

    // THEN - thrown, so there is no result the toolkit could turn into a retry prompt
    await expect(deployment).rejects.toThrow(/in a failed state/);
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ReplacementRequiresUnwedge' }));
    await expect(deployment).rejects.toThrow(/Revert your change/);
    await expect(deployment).rejects.toThrow(/cdk deploy --express --method=direct/);
    expectNoStackMutation();

    // ... and it is reported once, by the error, not also as a warning
    expect(ioHost.messagesWithCode(W5903)).toEqual([]);
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

  // Pins today's behaviour for #1971: detection keys on `PolicyAction`, so a replacement CloudFormation reports only
  // via `Replacement: 'True'` is NOT gated up front. It is still caught after the fact on the failure path. If #1971 is
  // fixed by widening detection, this test should flip to expecting the gate.
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
  // Standard mode also runs with rollback disabled under `--no-rollback`, and CloudFormation rejects replacements the
  // same way - but the guidance names Express Mode flags, and Express Mode is sticky and gives up `cdk rollback`. A
  // wedged standard-mode user recovers with a plain `cdk deploy`, so they must NOT be pushed towards `--express`.
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

    // THEN - the real CloudFormation error, and no Express Mode guidance
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
  //
  // NOTE: the stranded-but-replayable state is hand-seeded here. The fake assigns the failed change set's template to
  // the stack and does not restore the previous template the way a real resource rollback does, so this pins that we
  // handle such a state correctly - not that a simulated failed replacement naturally arrives at it. That a real
  // failed express replacement does leave the stack replayable was established by deploys against CloudFormation.
  test('a no-op replay against a hand-seeded stranded stack is not blocked', async () => {
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

/**
 * A change set carries the rollback policy it was created with. CloudFormation persists `DeploymentConfig` on
 * `CreateChangeSet`, returns it from `DescribeChangeSet`, and `ExecuteChangeSet` cannot override it (its input has no
 * `DeploymentConfig` field). So when create and execute happen in separate invocations - `--method=change-set
 * --no-execute` then `--method=execute-change-set`, or the toolkit's own retry - the second invocation's flags do not
 * decide what CloudFormation does. Deriving rollback safety from the current options there would let the SEV in #1931
 * back in: the guard would believe rollback is enabled and execute a rollback-disabled change set containing a
 * replacement.
 */
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

  test('a rollback-disabled change set is not executed just because this invocation passes --rollback', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: true, changes: [updateChange()] });
    failOnAnyStackMutation();

    // WHEN
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
      rollback: true,
    });

    // THEN
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ChangeSetRollbackPolicyMismatch' }));
    await expect(deployment).rejects.toThrow(/created with rollback disabled/);
    expectNoStackMutation();
  });

  // The SEV path: the change set contains a replacement and was created with rollback disabled. Executing it would put
  // the prohibited combination in front of CloudFormation and strand the stack.
  test('a rollback-disabled change set containing a replacement is never executed', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: true, changes: [policyActionReplacementChange()] });
    failOnAnyStackMutation();

    // WHEN - this is what the toolkit's retry does: same change set, rollback flipped on
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
      rollback: true,
    });

    // THEN
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ChangeSetRollbackPolicyMismatch' }));
    expectNoStackMutation();
    expect(fakeCfn.accessStack('withouterrors').status).toEqual(StackStatus.UPDATE_COMPLETE);
  });

  test('omitting --express does not make a persisted Express change set look safe', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: true, changes: [policyActionReplacementChange()] });
    failOnAnyStackMutation();

    // WHEN - the invocation looks like standard mode, but the change set is still Express + rollback disabled
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
    });

    // THEN
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ChangeSetRollbackPolicyMismatch' }));
    expectNoStackMutation();
  });

  test('the opposite mismatch is refused too: rollback-enabled change set executed as rollback-disabled', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: false, changes: [updateChange()] });
    failOnAnyStackMutation();

    // WHEN - plain `--express` requests rollback disabled, but the change set was created with it enabled
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ChangeSetRollbackPolicyMismatch' }));
    await expect(deployment).rejects.toThrow(/created with rollback enabled/);
    expectNoStackMutation();
  });

  // The matching case still has to be gated on the replacement itself, using the persisted policy.
  test('a matching rollback-disabled change set with a replacement is gated, not executed', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: true, changes: [policyActionReplacementChange()] });
    failOnAnyStackMutation();

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN
    expect(result.type).toEqual('replacement-requires-rollback');
    expectNoStackMutation();
    ioHost.expectMessage({ level: 'warn', code: W5903, containing: 'does not support while rollback is disabled' });
  });

  // `isRollbackable` also covers CREATE_FAILED, where there is no previously deployed configuration to replay. Telling
  // such a user to "revert your change and redeploy the last configuration that deployed successfully" would be
  // impossible advice, so that state gets its own guidance.
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
