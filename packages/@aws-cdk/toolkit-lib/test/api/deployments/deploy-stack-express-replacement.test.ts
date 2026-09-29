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

// Taken from the production message rather than restated, so renaming the code cannot leave the negative assertions
// below (`messagesWithCode(W5903)` returning nothing) vacuously true.
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

/**
 * Assert the `replay` guidance is ordered the way a wedged user needs to read it: the state the stack is actually in,
 * then the steps that return it to a terminal state, and only then the suggestion to deploy with rollback enabled.
 *
 * Ordering is the whole point of this message. `cdk deploy --express --rollback` cannot update a stack that is already
 * failed - CloudFormation answers "This stack is currently in a non-terminal [UPDATE_FAILED] state" - so guidance that
 * led with that command would be advice the user cannot act on. Containment assertions alone would not catch a
 * reordering, which is why these compare offsets.
 *
 * Deliberately anchored on the suggestion phrasing and NOT on `indexOf('--rollback')`: the FIRST occurrence of that flag
 * is the clause saying it cannot update a failed state, and that one legitimately comes before the unwedge steps. A
 * naive "unwedge before any --rollback mention" assertion would fail on the correct message.
 *
 * That carve-out left a blind spot, so it is pinned explicitly: the first mention of the rollback command must be the
 * "cannot update" clause. Without this, prepending an actionable `Deploy it with cdk deploy --express --rollback` line
 * ahead of the whole explanation is invisible to every other assertion here - the steps still follow "in a failed
 * state", and the closing suggestion still comes last.
 */
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

/**
 * Assert the `recreate` guidance never offers replay instructions.
 *
 * A stack that never completed a deployment has no previous configuration to go back to, so telling its owner to
 * "revert your change and redeploy the last configuration that deployed successfully" is impossible advice. This is the
 * variant whose wrongness is hardest to spot by hand, so it is pinned positively and negatively.
 */
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
    expectUnwedgeBeforeRollbackSuggestion(await deployment.then(() => '', (e) => e.message));
    expectNoStackMutation();

    // ... and the guidance is ALSO emitted as W5903, because `cdk deploy --watch` swallows the thrown error and would
    // otherwise show the user nothing actionable.
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
 * - aws/aws-cdk-cli#1745 disabled it twice over - an unconditional early return to `executeChangeSet` for express, plus
 *   deletion of the `expressNoRollback` disjunct from the guard condition - and inverted the case that covered it, so
 *   `['express, no explicit rollback', { express: true }]` asserted `did-deploy-stack` rather than
 *   `replacement-requires-rollback`. That shipped the regression in CLI 2.1133.0.
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
 * `CreateChangeSet`, returns it from `DescribeChangeSet`, and `ExecuteChangeSet` cannot override it: its input has no
 * `DeploymentConfig` field, and its top-level `DisableRollback` is a consistency assertion rather than an override - a
 * matching value is accepted, a conflicting one fails synchronously with `ValidationError: DisableRollback specified on
 * ExecuteChangeSet conflicts with the value DisableRollback the ChangeSet was created with.` So when create and execute
 * happen in separate invocations - `--method=change-set --no-execute` then `--method=execute-change-set`, or the
 * toolkit's own retry - the second invocation's flags do not decide what CloudFormation does. Deriving rollback safety
 * from the current options there would let the SEV in #1931 back in: the guard would believe rollback is enabled and
 * execute a rollback-disabled change set containing a replacement.
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

  // `--rollback` cannot be honoured on an existing change set, but without a replacement CloudFormation accepts the
  // execution, so refusing would break a deployment that works. Report that the flag is being ignored and continue.
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

    // THEN - terminal, because the retry would re-execute this same immutable change set
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

    // WHEN - the invocation looks like standard mode, but the change set is still Express + rollback disabled
    const deployment = testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
    });

    // THEN - the persisted mode is authoritative, so this is still gated as an express replacement
    await expect(deployment).rejects.toThrow(expect.objectContaining({ name: 'ReplacementRequiresRecreateChangeSet' }));
    expectNoStackMutation();
  });

  test('the opposite mismatch is reported too: rollback-enabled change set executed as rollback-disabled', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: false, changes: [updateChange()] });

    // WHEN - plain `--express` requests rollback disabled, but the change set was created with it enabled
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
    });

    // THEN - rollback stays ENABLED (the safer direction) and the ignored flag is reported
    expect(result.type).toEqual('did-deploy-stack');
    ioHost.expectMessage({ level: 'warn', containing: 'created with rollback enabled' });
  });

  // Even with the flags matching, an existing rollback-disabled change set containing a replacement cannot be made to
  // work: the retry the generic result would trigger re-executes this same change set. So it is terminal, and the
  // guidance says to recreate rather than to retry.
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

  /**
   * Seed a nested-stack shape: a child stack carrying its own change set, referenced from the root change set through
   * the nested stack resource's `ChangeSetId`. This is how CloudFormation reports nested changes when the root change
   * set is created with `IncludeNestedStacks: true`, which `createChangeSet()` always does for non-import deployments.
   *
   * The root entry deliberately reports no replacement of its own - `AWS::CloudFormation::Stack` is merely modified -
   * so a guard that only reads the root's `Changes` sees nothing to gate on.
   */
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

  /**
   * A replacement that only exists in a nested stack must be gated exactly like one in the root.
   *
   * Confirmed as a real bypass before it was fixed: with this exact shape the guard returned `did-deploy-stack` and
   * called `ExecuteChangeSet` once, emitting no `W5903` - i.e. #1931 straight through.
   */
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

  // The traversal must not gate a nested stack whose child changes nothing of consequence.
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

  /**
   * The full flag matrix for the policy comparison: `--express` decides what a missing `--rollback` means, so it has to
   * be read here exactly as it is when the change set is created. aws/aws-cdk-cli#1969 shipped with the CLI dropping
   * `express` on the `execute-change-set` delegation, which made plain `--express` mean "rollback enabled" and refused
   * Express change sets the same CLI had just created (`persisted disabled` x `express` x `rollback: undefined` below).
   */
  const POLICY_MATRIX = [
    // persisted rollback DISABLED (Express default)
    [true, { express: true, rollback: true }, 'reported'],
    [true, { express: true }, 'silent'],
    [true, { express: true, rollback: false }, 'silent'],
    [true, { rollback: true }, 'reported'],
    [true, {}, 'reported'],
    [true, { rollback: false }, 'silent'],
    // persisted rollback ENABLED
    [false, { express: true, rollback: true }, 'silent'],
    [false, { express: true }, 'reported'],
    [false, { express: true, rollback: false }, 'reported'],
    [false, { rollback: true }, 'silent'],
    [false, {}, 'silent'],
    [false, { rollback: false }, 'reported'],
  ] as Array<[boolean, Partial<DeployStackApiOptions>, 'silent' | 'reported']>;

  // Deleting a row would silently shrink this matrix, so its size is pinned.
  test('the policy matrix covers every express/rollback/persisted combination', () => {
    expect(POLICY_MATRIX).toHaveLength(12);
  });

  /**
   * `DisableRollback` on `ExecuteChangeSet` is a consistency assertion, not an override, so a value conflicting with the
   * change set's persisted policy fails the call outright with `ValidationError: DisableRollback specified on
   * ExecuteChangeSet conflicts with the value DisableRollback the ChangeSet was created with.`
   *
   * `commonExecuteOptions()` sends `DisableRollback: true` for an explicit `--no-rollback`, so executing a change set
   * created with rollback ENABLED under `--no-rollback` would send exactly that conflicting value. The flag cannot move
   * an already-pinned policy, so it must not be sent at all.
   */
  test('no DisableRollback is sent when the change set already pins the policy', async () => {
    // GIVEN - persisted policy says rollback ENABLED, the request asks for it DISABLED
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenExpressChangeSetExists({ rollbackDisabled: false, changes: [updateChange()] });

    // WHEN
    const result = await testDeployStack({
      ...standardDeployStackArguments(),
      ...executePrepared,
      express: true,
      rollback: false,
    });

    // THEN - executed rather than failing with ValidationError, and the flag was withheld
    expect(result.type).toEqual('did-deploy-stack');
    expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
    const sent = mockCloudFormationClient.commandCalls(ExecuteChangeSetCommand)[0].args[0].input;
    expect(sent).not.toHaveProperty('DisableRollback');
  });

  /**
   * The mirror of the above: a standard change set records no policy, so there the execute-time flag is the only thing
   * that decides and must still be sent.
   */
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
        // GIVEN - a non-replacing change, so nothing is gated and only the policy comparison is under test
        givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
        givenExpressChangeSetExists({ rollbackDisabled: persistedRollbackDisabled, changes: [updateChange()] });

        // WHEN
        const result = await testDeployStack({
          ...standardDeployStackArguments(),
          ...executePrepared,
          ...flags,
        });

        // THEN - without a replacement CloudFormation accepts the execution either way, so it always runs. A policy
        // that disagrees with the flags means the flags are not being honoured, which is reported but not refused.
        expect(result.type).toEqual('did-deploy-stack');
        expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);

        const warnings = ioHost.notifySpy.mock.calls
          .map((c) => c[0])
          .filter((m: any) => m.level === 'warn' && /was created with rollback/.test(m.message));
        expect(warnings).toHaveLength(expected === 'reported' ? 1 : 0);
      });
    },
  );

  /**
   * Only Express records a rollback choice on the change set. A STANDARD change set is governed by the `DisableRollback`
   * flag sent at execute time, and that flag is only sent for an explicit `--no-rollback` - so `--express` arriving at
   * execute time cannot disable rollback on it, and must not make the replacement guard think it did. Without this,
   * plumbing `express` through to the execute path turns `prepare` (standard) + `execute --express` into a false refusal.
   */
  test('--express does not imply rollback-disabled for a change set that is not Express', async () => {
    // GIVEN
    givenStackExists({ StackStatus: StackStatus.UPDATE_COMPLETE });
    givenChangeSetExists({ deploymentConfig: { Mode: 'STANDARD' }, changes: [policyActionReplacementChange()] });

    // WHEN - rollback is not disabled server-side here, so the replacement is deployable
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
