import { AbortError } from '@aws-cdk/toolkit-lib';
import { Deployments } from '../../lib/api';
import type { DestroyStackOptions } from '../../lib/api/deployments';
import { IO } from '../../lib/api-private';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import type { TestStackArtifact } from '../_helpers';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';
import { IoHostRecorder } from '../_helpers/io-recorder';

// The destroy command emits its progress as info messages and, on the
// confirmation/abort and failure paths, as requests/errors. These tests capture
// the *entire* ordered stream of messages the command sends to the CliIoHost as
// an NDJSON snapshot, so that rerouting `cdk destroy` through toolkit-lib cannot
// silently change the user-facing output (see test/_helpers/io-recorder.ts).

const STACK_A: TestStackArtifact = {
  stackName: 'Test-Stack-A',
  template: { Resources: { TemplateName: 'Test-Stack-A' } },
  env: 'aws://123456789012/bermuda-triangle-1',
  displayName: 'Test-Stack-A-Display-Name',
};
const STACK_B: TestStackArtifact = {
  stackName: 'Test-Stack-B',
  template: { Resources: { TemplateName: 'Test-Stack-B' } },
  env: 'aws://123456789012/bermuda-triangle-1',
};
const STACK_C_NESTED: TestStackArtifact = {
  stackName: 'Test-Stack-C',
  template: { Resources: { TemplateName: 'Test-Stack-C' } },
  env: 'aws://123456789012/bermuda-triangle-1',
  displayName: 'Test-Stack-A/Test-Stack-C',
};

let cloudExecutable: MockCloudExecutable;
let cloudFormation: jest.Mocked<Deployments>;
let toolkit: CdkToolkit;
let ioHost = CliIoHost.instance();
let recorder: IoHostRecorder;

beforeEach(async () => {
  // Mirror the legacy test setup: a fresh singleton state and fresh mocks per test.
  jest.resetAllMocks();

  ioHost = CliIoHost.instance();
  ioHost.isCI = false;
  // Run as the `destroy` command so every message — synthesis, the confirmation
  // request, and the destroy progress — is tagged with the `destroy` action,
  // exactly as the real CLI would.
  ioHost.currentAction = 'destroy';

  cloudExecutable = await MockCloudExecutable.create({
    stacks: [STACK_A, STACK_B],
    nestedAssemblies: [{ stacks: [STACK_C_NESTED] }],
  }, undefined, ioHost, 'destroy');

  cloudFormation = instanceMockFrom(Deployments);

  toolkit = new CdkToolkit({
    ioHost,
    cloudExecutable,
    configuration: cloudExecutable.configuration,
    sdkProvider: cloudExecutable.sdkProvider,
    deployments: cloudFormation,
  });

  // Single recorder bound to the (singleton) ioHost; `clearMocks` scopes the
  // captured messages to each test.
  recorder = IoHostRecorder.create(ioHost);
});

afterEach(() => {
  // Snapshot every message the destroy path sent to the CliIoHost. Any change to
  // that stream (e.g. when rerouting through toolkit-lib) shows up as a diff.
  recorder.matchSnapshot();
});

describe('force: true (no confirmation prompt)', () => {
  test('destroys a single (nested) stack; "fromDeploy" makes it say "deployed"', async () => {
    await toolkit.destroy({
      selector: { patterns: ['Test-Stack-A/Test-Stack-C'] },
      exclusively: true,
      force: true,
      fromDeploy: true,
    });

    expect(cloudFormation.destroyStack).toHaveBeenCalledTimes(1);
  });

  test('destroys all top-level stacks with concurrency', async () => {
    await toolkit.destroy({
      selector: { patterns: ['*'] },
      exclusively: false,
      force: true,
      concurrency: 5,
    });

    expect(cloudFormation.destroyStack).toHaveBeenCalledTimes(2);
  });

  test('respects dependency order with concurrency', async () => {
    const stackC: TestStackArtifact = {
      stackName: 'Test-Stack-C',
      template: { Resources: { TemplateName: 'Test-Stack-C' } },
      env: 'aws://123456789012/bermuda-triangle-1',
    };
    const stackD: TestStackArtifact = {
      stackName: 'Test-Stack-D',
      template: { Resources: { TemplateName: 'Test-Stack-D' } },
      env: 'aws://123456789012/bermuda-triangle-1',
      depends: [stackC.stackName],
    };
    cloudExecutable = await MockCloudExecutable.create({ stacks: [stackC, stackD] }, undefined, ioHost, 'destroy');

    const destroyOrder: string[] = [];
    cloudFormation.destroyStack.mockImplementation(async (options: DestroyStackOptions) => {
      destroyOrder.push(options.stack.stackName);
      return { stackArn: 'arn' };
    });

    toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    await toolkit.destroy({
      selector: { allTopLevel: true, patterns: [] },
      exclusively: false,
      force: true,
      concurrency: 10,
    });

    // stackD depends on stackC, so D must be destroyed before C.
    expect(destroyOrder.indexOf('Test-Stack-D')).toBeLessThan(destroyOrder.indexOf('Test-Stack-C'));
  });

  test('forwards the roleArn to destroyStack', async () => {
    await toolkit.destroy({
      selector: { patterns: ['Test-Stack-B'] },
      exclusively: true,
      force: true,
      roleArn: 'arn:aws:iam::123456789012:role/DestroyRole',
    });

    expect(cloudFormation.destroyStack).toHaveBeenCalledWith(
      expect.objectContaining({ roleArn: 'arn:aws:iam::123456789012:role/DestroyRole' }),
    );
  });
});

describe('force: false (confirmation prompt)', () => {
  test('asks for confirmation and proceeds when the user confirms', async () => {
    // Answer the confirmation prompt with a one-shot responder. The real
    // requestResponse runs (so the request is recorded in the snapshot); no
    // spy/pass-through is needed.
    ioHost.respondOnce(IO.CDK_TOOLKIT_I7010, true);

    await toolkit.destroy({
      selector: { patterns: ['Test-Stack-B'] },
      exclusively: true,
      force: false,
    });

    // Confirmed -> the stack is actually destroyed.
    expect(cloudFormation.destroyStack).toHaveBeenCalledTimes(1);
  });

  test('aborts with an AbortError and destroys nothing when the user declines', async () => {
    // The IoHost returns the answer; declining is `false` and the command aborts
    // by throwing an AbortError (non-zero exit, presented softly by the CLI).
    ioHost.respondOnce(IO.CDK_TOOLKIT_I7010, false);

    const error = await toolkit.destroy({
      selector: { patterns: ['Test-Stack-B'] },
      exclusively: true,
      force: false,
    }).catch((e) => e);

    expect(AbortError.isAbortError(error)).toBe(true);
    expect(error.name).toBe('DestroyAborted');

    // Aborted before any destroy happened.
    expect(cloudFormation.destroyStack).not.toHaveBeenCalled();
  });
});

describe('destroy failure', () => {
  test('emits a failure message and rethrows when destroyStack fails', async () => {
    cloudFormation.destroyStack.mockRejectedValue(new Error('Deletion failed'));

    await expect(toolkit.destroy({
      selector: { patterns: ['Test-Stack-B'] },
      exclusively: true,
      force: true,
    })).rejects.toThrow('Deletion failed');
  });
});
