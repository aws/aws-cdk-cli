import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { Deployments } from '../../lib/api';
import type { DestroyStackOptions } from '../../lib/api/deployments';
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
let destroyStackSpy: jest.SpyInstance;
let toolkit: CdkToolkit;
let ioHost = CliIoHost.instance();
let recorder: IoHostRecorder;

beforeEach(async () => {
  // Mirror the legacy test setup: a fresh singleton state and fresh mocks per test.
  jest.resetAllMocks();

  ioHost = CliIoHost.instance();
  ioHost.isCI = false;

  cloudExecutable = await MockCloudExecutable.create({
    stacks: [STACK_A, STACK_B],
    nestedAssemblies: [{ stacks: [STACK_C_NESTED] }],
  }, undefined, ioHost);

  cloudFormation = instanceMockFrom(Deployments);

  // `cdk destroy` delegates to toolkit-lib, which constructs its own
  // `Deployments` instance, so intercept the actual deletion at the prototype.
  destroyStackSpy = jest.spyOn(Deployments.prototype, 'destroyStack').mockResolvedValue({ stackArn: 'arn' } as any);

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

afterEach(async () => {
  // Snapshot every message the destroy path sent to the CliIoHost. Any change to
  // that stream (e.g. when rerouting through toolkit-lib) shows up as a diff.
  await recorder.matchSnapshot();
});

describe('force: true (no confirmation prompt)', () => {
  test('destroys a single (nested) stack; "fromDeploy" makes it say "deployed"', async () => {
    await toolkit.destroyFromDeploy({
      selector: { patterns: ['Test-Stack-A/Test-Stack-C'] },
      exclusively: true,
      force: true,
    });

    expect(destroyStackSpy).toHaveBeenCalledTimes(1);
  });

  test('destroys all top-level stacks with concurrency', async () => {
    await toolkit.destroy({
      selector: { patterns: ['*'] },
      exclusively: false,
      force: true,
      concurrency: 5,
    });

    expect(destroyStackSpy).toHaveBeenCalledTimes(2);
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
    cloudExecutable = await MockCloudExecutable.create({ stacks: [stackC, stackD] }, undefined, ioHost);

    const destroyOrder: string[] = [];
    destroyStackSpy.mockImplementation(async (options: DestroyStackOptions) => {
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

    expect(destroyStackSpy).toHaveBeenCalledWith(
      expect.objectContaining({ roleArn: 'arn:aws:iam::123456789012:role/DestroyRole' }),
    );
  });
});

describe('force: false (confirmation prompt)', () => {
  test('asks for confirmation and proceeds when the user confirms', async () => {
    jest.spyOn(ioHost, 'requestResponse').mockResolvedValue(true as any);

    await toolkit.destroy({
      selector: { patterns: ['Test-Stack-B'] },
      exclusively: true,
      force: false,
    });

    // Confirmed -> the stack is actually destroyed.
    expect(destroyStackSpy).toHaveBeenCalledTimes(1);
  });

  test('aborts (CDK_TOOLKIT_E7010) and destroys nothing when the user declines', async () => {
    // The IoHost throws AbortedByUser when the user declines a confirmation.
    jest.spyOn(ioHost, 'requestResponse').mockImplementation((() => {
      throw new ToolkitError('AbortedByUser', 'Aborted by user');
    }) as any);

    await toolkit.destroy({
      selector: { patterns: ['Test-Stack-B'] },
      exclusively: true,
      force: false,
    });

    // Aborted before any destroy happened.
    expect(destroyStackSpy).not.toHaveBeenCalled();
  });

  test('rethrows an unexpected error from the confirmation prompt', async () => {
    jest.spyOn(ioHost, 'requestResponse').mockImplementation((() => {
      throw new ToolkitError('SomethingElse', 'tty exploded');
    }) as any);

    await expect(toolkit.destroy({
      selector: { patterns: ['Test-Stack-B'] },
      exclusively: true,
      force: false,
    })).rejects.toThrow('tty exploded');

    expect(destroyStackSpy).not.toHaveBeenCalled();
  });
});

describe('destroy failure', () => {
  test('emits a failure message and rethrows when destroyStack fails', async () => {
    destroyStackSpy.mockRejectedValue(new Error('Deletion failed'));

    await expect(toolkit.destroy({
      selector: { patterns: ['Test-Stack-B'] },
      exclusively: true,
      force: true,
    })).rejects.toThrow('Deletion failed');
  });
});
