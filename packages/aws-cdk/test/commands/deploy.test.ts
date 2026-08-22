import { RequireApproval } from '@aws-cdk/cloud-assembly-schema';
import { Toolkit } from '@aws-cdk/toolkit-lib';
import { Deployments, selectAllTopLevel, selectExact, selectOnlySingle, selectWithUpstream } from '../../lib/api';
import { IO } from '../../lib/api-private';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { StackActivityProgress } from '../../lib/commands/deploy';
import type { TestStackArtifact } from '../_helpers';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';
import { IoHostRecorder } from '../_helpers/io-recorder';

// ANSI escape codes get injected whenever chalk's (global, process-wide) color
// level is enabled. Strip them so the assertion compares the visible text.
const stripAnsi = (str: string): string => str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');

// `cdk deploy` emits a stream of messages to the user: synthesis timing,
// the (optional) require-approval prompt, the hotswap/concurrency warnings,
// per-stack progress, outputs, and the deployment/total timings.

// A small stack with one resource, so `deployStack` is actually invoked (the
// CLI short-circuits stacks with zero resources).
const STACK_A: TestStackArtifact = {
  stackName: 'Test-Stack-A',
  template: { Resources: { TemplateName: { Type: 'AWS::CDK::Test' } } },
  env: 'aws://123456789012/bermuda-triangle-1',
  properties: { tags: { Foo: 'Bar' } },
  displayName: 'Test-Stack-A-Display-Name',
};
const STACK_B: TestStackArtifact = {
  stackName: 'Test-Stack-B',
  template: { Resources: { TemplateName: { Type: 'AWS::CDK::Test' } } },
  env: 'aws://123456789012/bermuda-triangle-1',
  properties: { tags: { Hello: 'World' } },
};
// Depends on Test-Stack-A, used to exercise dependency-ordered deployment.
const STACK_C_DEPENDS_ON_A: TestStackArtifact = {
  stackName: 'Test-Stack-C',
  template: { Resources: { TemplateName: { Type: 'AWS::CDK::Test' } } },
  env: 'aws://123456789012/bermuda-triangle-1',
  depends: ['Test-Stack-A'],
};

let cloudExecutable: MockCloudExecutable;
let cloudFormation: jest.Mocked<Deployments>;
let toolkit: CdkToolkit;
let ioHost = CliIoHost.instance();
let recorder: IoHostRecorder;

async function makeToolkit(stacks: TestStackArtifact[] = [STACK_A, STACK_B]) {
  cloudExecutable = await MockCloudExecutable.create({ stacks }, undefined, ioHost, 'deploy');
  return new CdkToolkit({
    ioHost,
    cloudExecutable,
    configuration: cloudExecutable.configuration,
    sdkProvider: cloudExecutable.sdkProvider,
    deployments: cloudFormation,
  });
}

// A Stage-nested app: there are no top-level stacks, both stacks live inside a
// Stage, so their hierarchical ids are namespaced like `MyStage/StackName`.
// A bare `cdk deploy` (no selector, no `--all`) therefore cannot pick a single
// stack and must guide the user towards the Stage wildcard pattern.
async function makeStagedToolkit() {
  cloudExecutable = await MockCloudExecutable.create({
    stacks: [],
    nestedAssemblies: [{
      stacks: [
        {
          stackName: 'StackA',
          template: { Resources: { TemplateName: { Type: 'AWS::CDK::Test' } } },
          env: 'aws://123456789012/bermuda-triangle-1',
          displayName: 'MyStage/StackA',
        },
        {
          stackName: 'StackB',
          template: { Resources: { TemplateName: { Type: 'AWS::CDK::Test' } } },
          env: 'aws://123456789012/bermuda-triangle-1',
          displayName: 'MyStage/StackB',
        },
      ],
    }],
  }, undefined, ioHost, 'deploy');
  return new CdkToolkit({
    ioHost,
    cloudExecutable,
    configuration: cloudExecutable.configuration,
    sdkProvider: cloudExecutable.sdkProvider,
    deployments: cloudFormation,
  });
}

beforeEach(async () => {
  // Mirror the destroy test setup: a fresh singleton state and fresh mocks per test.
  jest.resetAllMocks();

  ioHost = CliIoHost.instance();
  ioHost.isCI = false;
  // Run as the `deploy` command so every message is tagged with the `deploy`
  // action, exactly as the real CLI would.
  ioHost.currentAction = 'deploy';
  ioHost.stackProgress = StackActivityProgress.BAR;

  cloudFormation = instanceMockFrom(Deployments);
  // The deploy flow reads the current template (for the approval diff), checks
  // whether assets are already published (so they can be skipped), and finally
  // prepares + executes the deployment. Individual
  // tests override `prepareStack`/`deployStack` when they need to.
  cloudFormation.readCurrentTemplate.mockResolvedValue({});
  cloudFormation.isSingleAssetPublished.mockResolvedValue(false);
  cloudFormation.prepareStack.mockResolvedValue({
    type: 'did-deploy-stack',
    noOp: false,
    outputs: {},
    stackArn: 'arn:aws:cloudformation:bermuda-triangle-1:123456789012:stack/Test-Stack-A/abcd',
    deleteFailures: [],
    stabilizingResources: [],
    changeSet: { Status: 'CREATE_COMPLETE', Changes: [{ Type: 'Resource' }], ChangeSetName: 'cdk-deploy-change-set', $metadata: {} },
  });
  cloudFormation.deployStack.mockImplementation(async (options) => ({
    type: 'did-deploy-stack',
    stackArn: `arn:aws:cloudformation:bermuda-triangle-1:123456789012:stack/${options.stack.stackName}/abcd`,
    noOp: false,
    outputs: {},
    deleteFailures: [],
    stabilizingResources: [],
  }));

  toolkit = await makeToolkit();

  // Single recorder bound to the (singleton) ioHost; `resetAllMocks` scopes the
  // captured messages to each test.
  recorder = IoHostRecorder.create(ioHost);
});

afterEach(() => {
  // Snapshot every message the deploy path sent to the CliIoHost. Any change to
  // that stream shows up as a diff.
  recorder.matchSnapshot();
});

describe('require-approval', () => {
  test('--require-approval never deploys without prompting', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledTimes(1);
  });

  test('--require-approval any-change prompts and proceeds when confirmed', async () => {
    // Answer the approval prompt the real way: a one-shot responder, so the
    // real requestResponse runs and the request is recorded in the snapshot.
    ioHost.respondOnce(IO.CDK_TOOLKIT_I5060, true);

    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.ANYCHANGE,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledTimes(1);
  });

  test('--require-approval any-change aborts and deploys nothing when declined', async () => {
    ioHost.respondOnce(IO.CDK_TOOLKIT_I5060, false);

    await expect(toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.ANYCHANGE,
    })).rejects.toThrow(/Deployment cancelled/);

    // Declined before the change set was executed; the prepared change set is
    // cleaned up.
    expect(cloudFormation.deployStack).not.toHaveBeenCalled();
    expect(cloudFormation.cleanupChangeSet).toHaveBeenCalledWith(expect.anything(), 'cdk-deploy-change-set');
  });

  test('the approval question is reframed with the CLI `--require-approval` flag', async () => {
    // Answer "yes" but keep the question visible (suppressQuestion=false) so the
    // recorder captures the effective, listener-reframed prompt text. The default
    // mock stack has no security-sensitive changes (permissionChangeType: none).
    ioHost.respondOnce(IO.CDK_TOOLKIT_I5060, true, false);

    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.ANYCHANGE,
    });

    // toolkit-lib emits a flag-free motivation; the CLI's deploy listener adds
    // the `--require-approval` framing before the question reaches the user.
    const question = recorder.entries().find((e) => e.code === 'CDK_TOOLKIT_I5060');
    expect(question).toBeDefined();
    expect(stripAnsi(question!.message)).toBe(
      'Stack includes updates and "--require-approval" is set to \'any-change\'.\nDo you wish to deploy these changes?',
    );
  });
});

describe('deployment method', () => {
  test('--method=direct deploys without creating a change set upfront', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'direct' },
      requireApproval: RequireApproval.NEVER,
    });

    expect(cloudFormation.prepareStack).not.toHaveBeenCalled();
    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentMethod: { method: 'direct' } }),
    );
  });

  test('--no-execute prepares a change set without executing it', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set', execute: false },
      requireApproval: RequireApproval.NEVER,
    });

    expect(cloudFormation.prepareStack).toHaveBeenCalledTimes(1);
    expect(cloudFormation.deployStack).not.toHaveBeenCalled();
  });

  test('--hotswap warns that it introduces drift and should not be used in production', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'hotswap' },
      requireApproval: RequireApproval.NEVER,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledTimes(1);
  });

  test('--hotswap-fallback emits the drift warning and forwards the fallback method to deployStack', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      // `--hotswap-fallback` is `hotswap` with a CloudFormation fallback, so it
      // is still gated by the same drift warning as plain `--hotswap`.
      deploymentMethod: { method: 'hotswap', fallback: { method: 'change-set' } },
      requireApproval: RequireApproval.NEVER,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentMethod: { method: 'hotswap', fallback: { method: 'change-set' } },
      }),
    );
  });

  test('--revert-drift is carried on the change-set method into prepareStack', async () => {
    // `--revert-drift` is only valid with the (default) change-set method; it
    // rides along on the `deploymentMethod` and is forwarded when the change set
    // is prepared.
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set', revertDrift: true },
      requireApproval: RequireApproval.NEVER,
    });

    expect(cloudFormation.prepareStack).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentMethod: expect.objectContaining({ method: 'change-set', revertDrift: true }),
      }),
    );
  });

  test('--method=execute-change-set delegates to toolkit-lib without synthesizing or calling deployStack', async () => {
    // The execute-change-set flow short-circuits at the top of `deploy()` and
    // delegates to the toolkit-lib `Toolkit.deploy` (the change set already
    // exists).
    const toolkitDeploySpy = jest.spyOn(Toolkit.prototype, 'deploy').mockResolvedValue(undefined as any);

    try {
      await toolkit.deploy({
        selector: selectWithUpstream('Test-Stack-A-Display-Name'),
        deploymentMethod: { method: 'execute-change-set', changeSetName: 'MyChangeSet' },
        requireApproval: RequireApproval.NEVER,
      });

      expect(toolkitDeploySpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          deploymentMethod: { method: 'execute-change-set', changeSetName: 'MyChangeSet' },
          parameters: undefined,
        }),
      );
      expect(cloudFormation.prepareStack).not.toHaveBeenCalled();
      expect(cloudFormation.deployStack).not.toHaveBeenCalled();
    } finally {
      toolkitDeploySpy.mockRestore();
    }
  });
});

describe('no-op deploy', () => {
  test('a change set with no changes still prints outputs, timing and the stack ARN', async () => {
    cloudFormation.prepareStack.mockResolvedValue({
      type: 'did-deploy-stack',
      noOp: true,
      outputs: { BucketName: 'my-bucket' },
      stackArn: 'arn:aws:cloudformation:bermuda-triangle-1:123456789012:stack/Test-Stack-A/abcd',
      deleteFailures: [],
      stabilizingResources: [],
      changeSet: { Status: 'CREATE_COMPLETE', Changes: [], ChangeSetName: 'cdk-deploy-change-set', $metadata: {} },
    });

    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
    });

    // noOp prepare result is final; the execute call is skipped.
    expect(cloudFormation.deployStack).not.toHaveBeenCalled();
  });
});

describe('outputs', () => {
  test('stack outputs are printed after a successful deploy', async () => {
    cloudFormation.deployStack.mockResolvedValue({
      type: 'did-deploy-stack',
      stackArn: 'arn:aws:cloudformation:bermuda-triangle-1:123456789012:stack/Test-Stack-A/abcd',
      noOp: false,
      outputs: { BucketName: 'my-bucket', QueueUrl: 'https://example.com/q' },
      deleteFailures: [],
      stabilizingResources: [],
    });

    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledTimes(1);
  });
});

describe('multi-stack selection', () => {
  test('--all deploys every stack', async () => {
    await toolkit.deploy({
      selector: selectAllTopLevel(),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledTimes(2);
  });

  test('--exclusively deploys only the requested stack, skipping its dependencies', async () => {
    toolkit = await makeToolkit([STACK_A, STACK_C_DEPENDS_ON_A]);

    await toolkit.deploy({
      selector: selectExact('Test-Stack-C'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
    });

    // Only Test-Stack-C, not its dependency Test-Stack-A.
    expect(cloudFormation.deployStack).toHaveBeenCalledTimes(1);
    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({ deployName: 'Test-Stack-C' }),
    );
  });

  test('--concurrency > 1 forces "events" progress and deploys in dependency order', async () => {
    toolkit = await makeToolkit([STACK_A, STACK_C_DEPENDS_ON_A]);

    await toolkit.deploy({
      selector: selectAllTopLevel(),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      concurrency: 5,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledTimes(2);
  });

  test('--concurrency > 1 with --progress=bar warns that it is switching to "events"', async () => {
    await toolkit.deploy({
      selector: selectAllTopLevel(),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      concurrency: 5,
      progress: StackActivityProgress.BAR,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledTimes(2);
  });

  test('--concurrency > 1 with --progress=errors-only keeps "errors-only" progress', async () => {
    await toolkit.deploy({
      selector: selectAllTopLevel(),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      concurrency: 5,
      progress: StackActivityProgress.ERRORS_ONLY,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledTimes(2);
    expect(ioHost.stackProgress).toBe(StackActivityProgress.ERRORS_ONLY);
  });

  test('no selector on a Stage-nested app fails with guidance towards the Stage wildcard pattern', async () => {
    // GIVEN an app whose stacks all live inside a Stage.
    toolkit = await makeStagedToolkit();

    // WHEN a bare `cdk deploy` runs (no selector, no `--all`), THEN the command
    // synthesizes and then aborts at stack selection: the snapshot captures the
    // IO stream up to that point. The thrown error additionally points the user
    // at the pattern that selects the Stage's stacks (e.g. `'MyStage/*'`),
    // instead of only suggesting `--all`.
    const error = await toolkit.deploy({
      selector: selectOnlySingle(),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
    }).catch((e) => e);

    expect(stripAnsi(error.message)).toContain('Since this app includes more than a single stack');
    expect(stripAnsi(error.message)).toContain('Some of these stacks are nested inside a Stage');
    expect(stripAnsi(error.message)).toContain("'MyStage/*'");
    // Selection failed before anything was deployed.
    expect(cloudFormation.deployStack).not.toHaveBeenCalled();
  });

  test('no selector on a flat multi-stack app fails without mentioning Stages', async () => {
    // GIVEN a flat app with only top-level stacks (the default STACK_A/STACK_B).
    // WHEN a bare `cdk deploy` runs, THEN it still fails for lack of a selector,
    // but the Stage-specific guidance must not appear.
    const error = await toolkit.deploy({
      selector: selectOnlySingle(),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
    }).catch((e) => e);

    expect(stripAnsi(error.message)).toContain('Since this app includes more than a single stack');
    expect(stripAnsi(error.message)).not.toContain('Some of these stacks are nested inside a Stage');
    expect(cloudFormation.deployStack).not.toHaveBeenCalled();
  });
});

describe('deploy parameters forwarded to CloudFormation', () => {
  test('--role-arn is forwarded to deployStack', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      roleArn: 'arn:aws:iam::123456789012:role/DeployRole',
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({ roleArn: 'arn:aws:iam::123456789012:role/DeployRole' }),
    );
  });

  test('--tags are forwarded to deployStack', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      tags: [{ Key: 'Owner', Value: 'team-cdk' }],
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [{ Key: 'Owner', Value: 'team-cdk' }] }),
    );
  });

  test('--notification-arns are forwarded to deployStack', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      notificationArns: ['arn:aws:sns:bermuda-triangle-1:123456789012:MyTopic'],
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({ notificationArns: ['arn:aws:sns:bermuda-triangle-1:123456789012:MyTopic'] }),
    );
  });

  test('rollback triggers are converted and forwarded to deployStack', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      rollbackConfiguration: {
        triggers: [{ arn: 'arn:aws:cloudwatch:bermuda-triangle-1:123456789012:alarm:MyAlarm' }],
        monitoringTimeInMinutes: 10,
      },
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({
        rollbackConfiguration: {
          RollbackTriggers: [
            { Arn: 'arn:aws:cloudwatch:bermuda-triangle-1:123456789012:alarm:MyAlarm', Type: 'AWS::CloudWatch::Alarm' },
          ],
          MonitoringTimeInMinutes: 10,
        },
      }),
    );
  });

  test('an invalid rollback trigger arn is rejected', async () => {
    await expect(toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      rollbackConfiguration: {
        triggers: [{ arn: 'arn:aws:sns:bermuda-triangle-1:123456789012:not-an-alarm' }],
      },
    })).rejects.toThrow(/not a valid CloudWatch alarm arn/);
  });

  test('--no-rollback is forwarded to deployStack', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      rollback: false,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({ rollback: false }),
    );
  });

  test('--parameters are forwarded to deployStack', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      parameters: { MyParam: 'MyValue' },
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({ parameters: expect.objectContaining({ MyParam: 'MyValue' }) }),
    );
  });

  test('--build-exclude is forwarded to deployStack as reuseAssets', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      reuseAssets: ['asset-hash-1', 'asset-hash-2'],
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({ reuseAssets: ['asset-hash-1', 'asset-hash-2'] }),
    );
  });

  test('--force skips the published-asset check and forces the deployment', async () => {
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      force: true,
    });

    // With --force, skips checking whether we published the asset
    // `isSingleAssetPublished` is never consulted
    expect(cloudFormation.isSingleAssetPublished).not.toHaveBeenCalled();
    // the deployment is forced regardless of whether the template changed.
    expect(cloudFormation.prepareStack).toHaveBeenCalledWith(
      expect.objectContaining({ forceDeployment: true }),
    );
  });
});

describe('deploy failures', () => {
  test('wraps a failed resource deployment as "<stack> failed: <error>" and rethrows', async () => {
    // Error messages are not emitted to the IoHost, so the snapshot
    // shows the deploy stopping mid-flight rather than a failure line.
    const resourceFailure = Object.assign(
      new Error('Resource TemplateName did not stabilize (reason: CREATE_FAILED)'),
      { name: 'ResourceNotReady' },
    );
    cloudFormation.deployStack.mockRejectedValue(resourceFailure);

    const error = await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
    }).catch((e) => e);

    expect(stripAnsi(error.message)).toBe(
      '❌  Test-Stack-A failed: ResourceNotReady: Resource TemplateName did not stabilize (reason: CREATE_FAILED)',
    );
    expect(error.name).toBe('DeployStackFailed');
  });
});

describe('--express', () => {
  test('warns about resources still stabilizing when deployStack reports them', async () => {
    // Express Mode returns success while some resources are still settling; the
    // deploy path surfaces this as an extra warning listing those resources.
    cloudFormation.deployStack.mockResolvedValue({
      type: 'did-deploy-stack',
      stackArn: 'arn:aws:cloudformation:bermuda-triangle-1:123456789012:stack/Test-Stack-A/abcd',
      noOp: false,
      outputs: {},
      deleteFailures: [],
      stabilizingResources: [{
        logicalResourceId: 'MyResource',
        resourceType: 'AWS::S3::Bucket',
        reason: 'Resource operation completed using Express Mode. It may continue becoming available in the background.',
      }],
    });

    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      express: true,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({ express: true }),
    );
  });

  test('does not warn when no resources are still stabilizing', async () => {
    // Express Mode is on, but the default mock reports an empty
    // `stabilizingResources`, so the deploy path emits no stabilization warning.
    await toolkit.deploy({
      selector: selectExact('Test-Stack-A-Display-Name'),
      deploymentMethod: { method: 'change-set' },
      requireApproval: RequireApproval.NEVER,
      express: true,
    });

    expect(cloudFormation.deployStack).toHaveBeenCalledWith(
      expect.objectContaining({ express: true }),
    );
  });
});
