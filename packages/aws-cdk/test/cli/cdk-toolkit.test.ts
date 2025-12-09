// We need to mock the chokidar library, used by 'cdk watch'
const mockChokidarWatcherOn = jest.fn();
const fakeChokidarWatcher = {
  on: mockChokidarWatcherOn,
};
const fakeChokidarWatcherOn = {
  get readyCallback(): () => Promise<void> {
    expect(mockChokidarWatcherOn.mock.calls.length).toBeGreaterThanOrEqual(1);
    // The call to the first 'watcher.on()' in the production code is the one we actually want here.
    // This is a pretty fragile, but at least with this helper class,
    // we would have to change it only in one place if it ever breaks
    const firstCall = mockChokidarWatcherOn.mock.calls[0];
    // let's make sure the first argument is the 'ready' event,
    // just to be double safe
    expect(firstCall[0]).toBe('ready');
    // the second argument is the callback
    return firstCall[1];
  },

  get fileEventCallback(): (
  event: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir',
  path: string,
  ) => Promise<void> {
    expect(mockChokidarWatcherOn.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondCall = mockChokidarWatcherOn.mock.calls[1];
    // let's make sure the first argument is not the 'ready' event,
    // just to be double safe
    expect(secondCall[0]).not.toBe('ready');
    // the second argument is the callback
    return secondCall[1];
  },
};

const mockChokidarWatch = jest.fn();
jest.mock('chokidar', () => ({
  watch: mockChokidarWatch,
}));
const fakeChokidarWatch = {
  get includeArgs(): string[] {
    expect(mockChokidarWatch.mock.calls.length).toBe(1);
    // the include args are the first parameter to the 'watch()' call
    return mockChokidarWatch.mock.calls[0][0];
  },

  get excludeArgs(): string[] {
    expect(mockChokidarWatch.mock.calls.length).toBe(1);
    // the ignore args are a property of the second parameter to the 'watch()' call
    const chokidarWatchOpts = mockChokidarWatch.mock.calls[0][1];
    return chokidarWatchOpts.ignored;
  },
};

jest.setTimeout(30_000);

import 'aws-sdk-client-mock';
import * as os from 'os';
import * as path from 'path';
import * as cdkAssets from '@aws-cdk/cdk-assets-lib';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import { Manifest, RequireApproval } from '@aws-cdk/cloud-assembly-schema';
import * as cxapi from '@aws-cdk/cx-api';
import type { DeploymentMethod } from '@aws-cdk/toolkit-lib';
import type { DestroyStackResult } from '@aws-cdk/toolkit-lib/lib/api/deployments/deploy-stack';
import { DescribeStacksCommand, GetTemplateCommand, StackStatus } from '@aws-sdk/client-cloudformation';
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import * as fs from 'fs-extra';
import type { Template, SdkProvider } from '../../lib/api';
import { Bootstrapper, type BootstrapSource } from '../../lib/api/bootstrap';
import type {
  DeployStackResult,
  SuccessfulDeployStackResult,
  DeployStackOptions,
  DestroyStackOptions,
  RollbackStackOptions,
  RollbackStackResult,
} from '../../lib/api/deployments';
import {
  Deployments,
} from '../../lib/api/deployments';
import { Mode } from '../../lib/api/plugin';
import type { Tag } from '../../lib/api/tags';
import { asIoHelper } from '../../lib/api-private';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { Configuration } from '../../lib/cli/user-configuration';
import { StackActivityProgress } from '../../lib/commands/deploy';
import { flatten } from '../../lib/util';
import { instanceMockFrom } from '../_helpers/as-mock';
import type { TestStackArtifact } from '../_helpers/assembly';
import { MockCloudExecutable } from '../_helpers/assembly';
import { expectIoMsg } from '../_helpers/io-host';
import {
  mockCloudFormationClient,
  MockSdk,
  MockSdkProvider,
  mockSSMClient,
  restoreSdkMocksToDefault,
} from '../_helpers/mock-sdk';
import { promiseWithResolvers } from '../_helpers/promises';

const defaultBootstrapSource: BootstrapSource = { source: 'default' };
const bootstrapEnvironmentMock = jest.spyOn(Bootstrapper.prototype, 'bootstrapEnvironment');
let cloudExecutable: MockCloudExecutable;
let ioHost = CliIoHost.instance();
let ioHelper = asIoHelper(ioHost, 'deploy');
let notifySpy = jest.spyOn(ioHost, 'notify');
let requestSpy = jest.spyOn(ioHost, 'requestResponse');

beforeEach(async () => {
  jest.resetAllMocks();
  restoreSdkMocksToDefault();

  mockChokidarWatch.mockReturnValue(fakeChokidarWatcher);
  // on() in chokidar's Watcher returns 'this'
  mockChokidarWatcherOn.mockReturnValue(fakeChokidarWatcher);

  bootstrapEnvironmentMock.mockResolvedValue({
    noOp: false,
    outputs: {},
    type: 'did-deploy-stack',
    stackArn: 'fake-arn',
  });

  cloudExecutable = await MockCloudExecutable.create({
    stacks: [MockStack.MOCK_STACK_A, MockStack.MOCK_STACK_B],
    nestedAssemblies: [
      {
        stacks: [MockStack.MOCK_STACK_C],
      },
    ],
  });

  ioHost = CliIoHost.instance();
  ioHelper = asIoHelper(ioHost, 'deploy');
  ioHost.isCI = false;
  notifySpy = jest.spyOn(ioHost, 'notify');
});

function defaultToolkitSetup() {
  return new CdkToolkit({
    ioHost,
    cloudExecutable,
    configuration: cloudExecutable.configuration,
    sdkProvider: cloudExecutable.sdkProvider,
    deployments: new FakeCloudFormation({
      'Test-Stack-A': { Foo: 'Bar' },
      'Test-Stack-B': { Baz: 'Zinga!' },
      'Test-Stack-C': { Baz: 'Zinga!' },
    }),
  });
}

const mockSdk = new MockSdk();

describe('bootstrap', () => {
  test('accepts qualifier from context', async () => {
    // GIVEN
    const toolkit = defaultToolkitSetup();
    const configuration = await Configuration.fromArgs(ioHelper);
    configuration.context.set('@aws-cdk/core:bootstrapQualifier', 'abcde');

    // WHEN
    await toolkit.bootstrap(['aws://56789/south-pole'], {
      source: defaultBootstrapSource,
      parameters: {
        qualifier: configuration.context.get('@aws-cdk/core:bootstrapQualifier'),
      },
    });

    // THEN
    expect(bootstrapEnvironmentMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      parameters: {
        qualifier: 'abcde',
      },
      source: defaultBootstrapSource,
    });
  });
});

describe('list', () => {
  test('smoke test for list', async () => {
    // GIVEN
    const toolkit = defaultToolkitSetup();

    // WHEN
    const result = await toolkit.list([]);

    // THEN
    expect(result).toEqual(0); // Exit code
    expect(notifySpy).toHaveBeenCalledWith(expectIoMsg('Test-Stack-A-Display-Name', 'result'));
    expect(notifySpy).toHaveBeenCalledWith(expectIoMsg('Test-Stack-B', 'result'));
    expect(notifySpy).toHaveBeenCalledWith(expectIoMsg('Test-Stack-A/Test-Stack-C', 'result'));
  });
});

describe('deploy', () => {
  test('fails when no valid stack names are given', async () => {
    // GIVEN
    const toolkit = defaultToolkitSetup();

    // WHEN
    await expect(() =>
      toolkit.deploy({
        selector: { patterns: ['Test-Stack-D'] },
        deploymentMethod: { method: 'change-set' },
      }),
    ).rejects.toThrow('No stacks match the name(s) Test-Stack-D');
  });

  describe('with hotswap deployment', () => {
    test("passes through the 'hotswap' option to CloudFormationDeployments.deployStack()", async () => {
      // GIVEN
      const mockCfnDeployments = instanceMockFrom(Deployments);
      mockCfnDeployments.deployStack.mockReturnValue(
        Promise.resolve({
          type: 'did-deploy-stack',
          noOp: false,
          outputs: {},
          stackArn: 'stackArn',
          stackArtifact: instanceMockFrom(cxapi.CloudFormationStackArtifact),
        }),
      );
      const cdkToolkit = new CdkToolkit({
        ioHost,
        cloudExecutable,
        configuration: cloudExecutable.configuration,
        sdkProvider: cloudExecutable.sdkProvider,
        deployments: mockCfnDeployments,
      });

      // WHEN
      await cdkToolkit.deploy({
        selector: { patterns: ['Test-Stack-A-Display-Name'] },
        requireApproval: RequireApproval.NEVER,
        deploymentMethod: {
          method: 'hotswap',
          fallback: { method: 'change-set' },
        },
      });

      // THEN
      expect(mockCfnDeployments.deployStack).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentMethod: {
            method: 'hotswap',
            fallback: { method: 'change-set' },
          },
        }),
      );
    });
  });

  describe('makes correct CloudFormation calls', () => {
    test('without options', async () => {
      // GIVEN
      const toolkit = defaultToolkitSetup();

      // WHEN
      await toolkit.deploy({
        selector: { patterns: ['Test-Stack-A', 'Test-Stack-B'] },
        deploymentMethod: { method: 'change-set' },
      });
    });

    test('with stacks all stacks specified as double wildcard', async () => {
      // GIVEN
      const toolkit = defaultToolkitSetup();

      // WHEN
      await toolkit.deploy({
        selector: { patterns: ['**'] },
        deploymentMethod: { method: 'change-set' },
      });
    });

    test('with one stack specified', async () => {
      // GIVEN
      const toolkit = defaultToolkitSetup();

      // WHEN
      await toolkit.deploy({
        selector: { patterns: ['Test-Stack-A-Display-Name'] },
        deploymentMethod: { method: 'change-set' },
      });
    });

    test('uses display names to reference assets', async () => {
      // GIVEN
      cloudExecutable = await MockCloudExecutable.create({
        stacks: [MockStack.MOCK_STACK_WITH_ASSET],
      });
      const toolkit = new CdkToolkit({
        ioHost,
        cloudExecutable,
        configuration: cloudExecutable.configuration,
        sdkProvider: cloudExecutable.sdkProvider,
        deployments: new FakeCloudFormation({}),
      });

      // WHEN
      await toolkit.deploy({
        selector: { patterns: [MockStack.MOCK_STACK_WITH_ASSET.stackName] },
        deploymentMethod: { method: 'change-set' },
      });

      // THEN
      expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Building Asset Display Name') }));
      expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Publishing Asset Display Name (desto)') }));
    });

    test('force flag is passed to asset publishing', async () => {
      // GIVEN
      cloudExecutable = await MockCloudExecutable.create({
        stacks: [MockStack.MOCK_STACK_WITH_ASSET],
      });
      const toolkit = new CdkToolkit({
        ioHost,
        cloudExecutable,
        configuration: cloudExecutable.configuration,
        sdkProvider: cloudExecutable.sdkProvider,
        deployments: new FakeCloudFormation({}),
      });

      const publishEntry = jest.spyOn(cdkAssets.AssetPublishing.prototype, 'publishEntry');

      // WHEN
      await toolkit.deploy({
        selector: { patterns: [MockStack.MOCK_STACK_WITH_ASSET.stackName] },
        deploymentMethod: { method: 'change-set' },
        force: true,
      });

      // THEN
      expect(publishEntry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        force: true,
      }));

      publishEntry.mockRestore();
    });

    test('with stacks all stacks specified as wildcard', async () => {
      // GIVEN
      const toolkit = defaultToolkitSetup();

      // WHEN
      await toolkit.deploy({
        selector: { patterns: ['*'] },
        deploymentMethod: { method: 'change-set' },
      });
    });

    describe('sns notification arns', () => {
      beforeEach(async () => {
        cloudExecutable = await MockCloudExecutable.create({
          stacks: [
            MockStack.MOCK_STACK_A,
            MockStack.MOCK_STACK_B,
            MockStack.MOCK_STACK_WITH_NOTIFICATION_ARNS,
            MockStack.MOCK_STACK_WITH_BAD_NOTIFICATION_ARNS,
          ],
        });
      });

      test('with sns notification arns as options', async () => {
        // GIVEN
        const notificationArns = [
          'arn:aws:sns:us-east-2:444455556666:MyTopic',
          'arn:aws:sns:eu-west-1:111155556666:my-great-topic',
        ];
        const toolkit = new CdkToolkit({
          ioHost,
          cloudExecutable,
          configuration: cloudExecutable.configuration,
          sdkProvider: cloudExecutable.sdkProvider,
          deployments: new FakeCloudFormation(
            {
              'Test-Stack-A': { Foo: 'Bar' },
            },
            notificationArns,
          ),
        });

        // WHEN
        await toolkit.deploy({
          // Stacks should be selected by their hierarchical ID, which is their displayName, not by the stack ID.
          selector: { patterns: ['Test-Stack-A-Display-Name'] },
          notificationArns,
          deploymentMethod: { method: 'change-set' },
        });
      });

      test('fail with incorrect sns notification arns as options', async () => {
        // GIVEN
        const notificationArns = ['arn:::cfn-my-cool-topic'];
        const toolkit = new CdkToolkit({
          ioHost,
          cloudExecutable,
          configuration: cloudExecutable.configuration,
          sdkProvider: cloudExecutable.sdkProvider,
          deployments: new FakeCloudFormation(
            {
              'Test-Stack-A': { Foo: 'Bar' },
            },
            notificationArns,
          ),
        });

        // WHEN
        await expect(() =>
          toolkit.deploy({
            // Stacks should be selected by their hierarchical ID, which is their displayName, not by the stack ID.
            selector: { patterns: ['Test-Stack-A-Display-Name'] },
            notificationArns,
            deploymentMethod: { method: 'change-set' },
          }),
        ).rejects.toThrow('Notification arn arn:::cfn-my-cool-topic is not a valid arn for an SNS topic');
      });

      test('with sns notification arns in the executable', async () => {
        // GIVEN
        const expectedNotificationArns = ['arn:aws:sns:bermuda-triangle-1337:123456789012:MyTopic'];
        const toolkit = new CdkToolkit({
          ioHost,
          cloudExecutable,
          configuration: cloudExecutable.configuration,
          sdkProvider: cloudExecutable.sdkProvider,
          deployments: new FakeCloudFormation(
            {
              'Test-Stack-Notification-Arns': { Foo: 'Bar' },
            },
            expectedNotificationArns,
          ),
        });

        // WHEN
        await toolkit.deploy({
          selector: { patterns: ['Test-Stack-Notification-Arns'] },
          deploymentMethod: { method: 'change-set' },
        });
      });

      test('fail with incorrect sns notification arns in the executable', async () => {
        // GIVEN
        const toolkit = new CdkToolkit({
          ioHost,
          cloudExecutable,
          configuration: cloudExecutable.configuration,
          sdkProvider: cloudExecutable.sdkProvider,
          deployments: new FakeCloudFormation({
            'Test-Stack-Bad-Notification-Arns': { Foo: 'Bar' },
          }),
        });

        // WHEN
        await expect(() =>
          toolkit.deploy({
            selector: { patterns: ['Test-Stack-Bad-Notification-Arns'] },
            deploymentMethod: { method: 'change-set' },
          }),
        ).rejects.toThrow('Notification arn arn:1337:123456789012:sns:bad is not a valid arn for an SNS topic');
      });

      test('with sns notification arns in the executable and as options', async () => {
        // GIVEN
        const notificationArns = [
          'arn:aws:sns:us-east-2:444455556666:MyTopic',
          'arn:aws:sns:eu-west-1:111155556666:my-great-topic',
        ];

        const expectedNotificationArns = notificationArns.concat([
          'arn:aws:sns:bermuda-triangle-1337:123456789012:MyTopic',
        ]);
        const toolkit = new CdkToolkit({
          ioHost,
          cloudExecutable,
          configuration: cloudExecutable.configuration,
          sdkProvider: cloudExecutable.sdkProvider,
          deployments: new FakeCloudFormation(
            {
              'Test-Stack-Notification-Arns': { Foo: 'Bar' },
            },
            expectedNotificationArns,
          ),
        });

        // WHEN
        await toolkit.deploy({
          selector: { patterns: ['Test-Stack-Notification-Arns'] },
          notificationArns,
          deploymentMethod: { method: 'change-set' },
        });
      });

      test('fail with incorrect sns notification arns in the executable and incorrect sns notification arns as options', async () => {
        // GIVEN
        const notificationArns = ['arn:::cfn-my-cool-topic'];
        const toolkit = new CdkToolkit({
          ioHost,
          cloudExecutable,
          configuration: cloudExecutable.configuration,
          sdkProvider: cloudExecutable.sdkProvider,
          deployments: new FakeCloudFormation(
            {
              'Test-Stack-Bad-Notification-Arns': { Foo: 'Bar' },
            },
            notificationArns,
          ),
        });

        // WHEN
        await expect(() =>
          toolkit.deploy({
            selector: { patterns: ['Test-Stack-Bad-Notification-Arns'] },
            notificationArns,
            deploymentMethod: { method: 'change-set' },
          }),
        ).rejects.toThrow('Notification arn arn:::cfn-my-cool-topic is not a valid arn for an SNS topic');
      });

      test('fail with incorrect sns notification arns in the executable and correct sns notification arns as options', async () => {
        // GIVEN
        const notificationArns = ['arn:aws:sns:bermuda-triangle-1337:123456789012:MyTopic'];
        const toolkit = new CdkToolkit({
          ioHost,
          cloudExecutable,
          configuration: cloudExecutable.configuration,
          sdkProvider: cloudExecutable.sdkProvider,
          deployments: new FakeCloudFormation(
            {
              'Test-Stack-Bad-Notification-Arns': { Foo: 'Bar' },
            },
            notificationArns,
          ),
        });

        // WHEN
        await expect(() =>
          toolkit.deploy({
            selector: { patterns: ['Test-Stack-Bad-Notification-Arns'] },
            notificationArns,
            deploymentMethod: { method: 'change-set' },
          }),
        ).rejects.toThrow('Notification arn arn:1337:123456789012:sns:bad is not a valid arn for an SNS topic');
      });

      test('fail with correct sns notification arns in the executable and incorrect sns notification arns as options', async () => {
        // GIVEN
        const notificationArns = ['arn:::cfn-my-cool-topic'];
        const toolkit = new CdkToolkit({
          ioHost,
          cloudExecutable,
          configuration: cloudExecutable.configuration,
          sdkProvider: cloudExecutable.sdkProvider,
          deployments: new FakeCloudFormation(
            {
              'Test-Stack-Notification-Arns': { Foo: 'Bar' },
            },
            notificationArns,
          ),
        });

        // WHEN
        await expect(() =>
          toolkit.deploy({
            selector: { patterns: ['Test-Stack-Notification-Arns'] },
            notificationArns,
            deploymentMethod: { method: 'change-set' },
          }),
        ).rejects.toThrow('Notification arn arn:::cfn-my-cool-topic is not a valid arn for an SNS topic');
      });
    });
  });

  test('globless bootstrap uses environment without question', async () => {
    // GIVEN
    const toolkit = defaultToolkitSetup();

    // WHEN
    await toolkit.bootstrap(['aws://56789/south-pole'], {
      source: defaultBootstrapSource,
    });

    // THEN
    expect(bootstrapEnvironmentMock).toHaveBeenCalledWith(
      {
        account: '56789',
        region: 'south-pole',
        name: 'aws://56789/south-pole',
      },
      expect.anything(),
      expect.anything(),
    );
    expect(bootstrapEnvironmentMock).toHaveBeenCalledTimes(1);
  });

  test('globby bootstrap uses whats in the stacks', async () => {
    // GIVEN
    const toolkit = defaultToolkitSetup();
    cloudExecutable.configuration.settings.set(['app'], 'something');

    // WHEN
    await toolkit.bootstrap(['aws://*/bermuda-triangle-1'], {
      source: defaultBootstrapSource,
    });

    // THEN
    expect(bootstrapEnvironmentMock).toHaveBeenCalledWith(
      {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      expect.anything(),
      expect.anything(),
    );
    expect(bootstrapEnvironmentMock).toHaveBeenCalledTimes(1);
  });

  test('bootstrap can be invoked without the --app argument', async () => {
    // GIVEN
    cloudExecutable.configuration.settings.clear();
    const mockSynthesize = jest.fn();
    cloudExecutable.synthesize = mockSynthesize;

    const toolkit = defaultToolkitSetup();

    // WHEN
    await toolkit.bootstrap(['aws://123456789012/west-pole'], {
      source: defaultBootstrapSource,
    });

    // THEN
    expect(bootstrapEnvironmentMock).toHaveBeenCalledWith(
      {
        account: '123456789012',
        region: 'west-pole',
        name: 'aws://123456789012/west-pole',
      },
      expect.anything(),
      expect.anything(),
    );
    expect(bootstrapEnvironmentMock).toHaveBeenCalledTimes(1);

    expect(cloudExecutable.hasApp).toEqual(false);
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  describe('readCurrentTemplate', () => {
    let template: any;
    let mockCloudExecutable: MockCloudExecutable;
    let sdkProvider: SdkProvider;
    let mockForEnvironment: any;
    beforeEach(async () => {
      jest.resetAllMocks();
      template = {
        Resources: {
          Func: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Key: 'Value',
            },
          },
        },
      };
      mockCloudExecutable = await MockCloudExecutable.create({
        stacks: [
          {
            stackName: 'Test-Stack-C',
            template,
            properties: {
              assumeRoleArn: 'bloop:${AWS::Region}:${AWS::AccountId}',
              lookupRole: {
                arn: 'bloop-lookup:${AWS::Region}:${AWS::AccountId}',
                requiresBootstrapStackVersion: 5,
                bootstrapStackVersionSsmParameter: '/bootstrap/parameter',
              },
            },
          },
          {
            stackName: 'Test-Stack-A',
            template,
            properties: {
              assumeRoleArn: 'bloop:${AWS::Region}:${AWS::AccountId}',
            },
          },
        ],
      });
      sdkProvider = mockCloudExecutable.sdkProvider;
      mockForEnvironment = jest
        .spyOn(sdkProvider, 'forEnvironment')
        .mockResolvedValue({ sdk: mockSdk, didAssumeRole: true });
      mockCloudFormationClient
        .on(GetTemplateCommand)
        .resolves({
          TemplateBody: JSON.stringify(template),
        })
        .on(DescribeStacksCommand)
        .resolves({
          Stacks: [
            {
              StackName: 'Test-Stack-C',
              StackStatus: StackStatus.CREATE_COMPLETE,
              CreationTime: new Date(),
            },
            {
              StackName: 'Test-Stack-A',
              StackStatus: StackStatus.CREATE_COMPLETE,
              CreationTime: new Date(),
            },
          ],
        });
    });

    test('lookup role is used', async () => {
      // GIVEN
      mockSSMClient.on(GetParameterCommand).resolves({ Parameter: { Value: '6' } });

      const cdkToolkit = new CdkToolkit({
        ioHost,
        cloudExecutable: mockCloudExecutable,
        configuration: mockCloudExecutable.configuration,
        sdkProvider: mockCloudExecutable.sdkProvider,
        deployments: new Deployments({
          sdkProvider: mockCloudExecutable.sdkProvider,
          ioHelper,
        }),
      });

      // WHEN
      await cdkToolkit.deploy({
        selector: { patterns: ['Test-Stack-C'] },
        deploymentMethod: { method: 'change-set' },
      });

      // THEN
      expect(mockSSMClient).toHaveReceivedCommandWith(GetParameterCommand, {
        Name: '/bootstrap/parameter',
      });
      expect(mockForEnvironment).toHaveBeenCalledTimes(2);
      expect(mockForEnvironment).toHaveBeenNthCalledWith(
        1,
        {
          account: '123456789012',
          name: 'aws://123456789012/here',
          region: 'here',
        },
        0,
        {
          assumeRoleArn: 'bloop-lookup:here:123456789012',
          assumeRoleExternalId: undefined,
        },
      );
    });

    test('fallback to deploy role if bootstrap stack version is not valid', async () => {
      // GIVEN
      mockSSMClient.on(GetParameterCommand).resolves({ Parameter: { Value: '1' } });

      const cdkToolkit = new CdkToolkit({
        ioHost,
        cloudExecutable: mockCloudExecutable,
        configuration: mockCloudExecutable.configuration,
        sdkProvider: mockCloudExecutable.sdkProvider,
        deployments: new Deployments({
          sdkProvider: mockCloudExecutable.sdkProvider,
          ioHelper,
        }),
      });

      // WHEN
      await cdkToolkit.deploy({
        selector: { patterns: ['Test-Stack-C'] },
        deploymentMethod: { method: 'change-set' },
      });

      // THEN
      expect(flatten(notifySpy.mock.calls)).toEqual(
        expect.arrayContaining([
          expectIoMsg(
            expect.stringContaining("Bootstrap stack version '5' is required, found version '1'. To get rid of this error, please upgrade to bootstrap version >= 5"),
          ),
        ]),
      );
      expect(mockSSMClient).toHaveReceivedCommandWith(GetParameterCommand, {
        Name: '/bootstrap/parameter',
      });
      expect(mockForEnvironment).toHaveBeenCalledTimes(3);
      expect(mockForEnvironment).toHaveBeenNthCalledWith(
        1,
        {
          account: '123456789012',
          name: 'aws://123456789012/here',
          region: 'here',
        },
        0,
        {
          assumeRoleArn: 'bloop-lookup:here:123456789012',
          assumeRoleExternalId: undefined,
        },
      );
      expect(mockForEnvironment).toHaveBeenNthCalledWith(
        2,
        {
          account: '123456789012',
          name: 'aws://123456789012/here',
          region: 'here',
        },
        0,
        {
          assumeRoleArn: 'bloop:here:123456789012',
          assumeRoleExternalId: undefined,
        },
      );
    });

    test('fallback to deploy role if bootstrap version parameter not found', async () => {
      // GIVEN
      mockSSMClient.on(GetParameterCommand).callsFake(() => {
        const e: any = new Error('not found');
        e.code = e.name = 'ParameterNotFound';
        throw e;
      });

      const cdkToolkit = new CdkToolkit({
        ioHost,
        cloudExecutable: mockCloudExecutable,
        configuration: mockCloudExecutable.configuration,
        sdkProvider: mockCloudExecutable.sdkProvider,
        deployments: new Deployments({
          sdkProvider: mockCloudExecutable.sdkProvider,
          ioHelper,
        }),
      });

      // WHEN
      await cdkToolkit.deploy({
        selector: { patterns: ['Test-Stack-C'] },
        deploymentMethod: { method: 'change-set' },
      });

      // THEN
      expect(flatten(notifySpy.mock.calls)).toEqual(
        expect.arrayContaining([expectIoMsg(expect.stringMatching(/SSM parameter.*not found./))]),
      );
      expect(mockForEnvironment).toHaveBeenCalledTimes(3);
      expect(mockForEnvironment).toHaveBeenNthCalledWith(
        1,
        {
          account: '123456789012',
          name: 'aws://123456789012/here',
          region: 'here',
        },
        0,
        {
          assumeRoleArn: 'bloop-lookup:here:123456789012',
          assumeRoleExternalId: undefined,
        },
      );
      expect(mockForEnvironment).toHaveBeenNthCalledWith(
        2,
        {
          account: '123456789012',
          name: 'aws://123456789012/here',
          region: 'here',
        },
        0,
        {
          assumeRoleArn: 'bloop:here:123456789012',
          assumeRoleExternalId: undefined,
        },
      );
    });

    test('fallback to deploy role if forEnvironment throws', async () => {
      // GIVEN
      // throw error first for the 'prepareSdkWithLookupRoleFor' call and succeed for the rest
      mockForEnvironment = jest.spyOn(sdkProvider, 'forEnvironment').mockImplementationOnce(() => {
        throw new Error('TheErrorThatGetsThrown');
      });

      const cdkToolkit = new CdkToolkit({
        ioHost,
        cloudExecutable: mockCloudExecutable,
        configuration: mockCloudExecutable.configuration,
        sdkProvider: mockCloudExecutable.sdkProvider,
        deployments: new Deployments({
          sdkProvider: mockCloudExecutable.sdkProvider,
          ioHelper,
        }),
      });

      // WHEN
      await cdkToolkit.deploy({
        selector: { patterns: ['Test-Stack-C'] },
        deploymentMethod: { method: 'change-set' },
      });

      // THEN
      expect(mockSSMClient).not.toHaveReceivedAnyCommand();
      expect(flatten(notifySpy.mock.calls)).toEqual(
        expect.arrayContaining([expectIoMsg(expect.stringMatching(/TheErrorThatGetsThrown/))]),
      );
      expect(mockForEnvironment).toHaveBeenCalledTimes(3);
      expect(mockForEnvironment).toHaveBeenNthCalledWith(
        1,
        {
          account: '123456789012',
          name: 'aws://123456789012/here',
          region: 'here',
        },
        0,
        {
          assumeRoleArn: 'bloop-lookup:here:123456789012',
          assumeRoleExternalId: undefined,
        },
      );
      expect(mockForEnvironment).toHaveBeenNthCalledWith(
        2,
        {
          account: '123456789012',
          name: 'aws://123456789012/here',
          region: 'here',
        },
        0,
        {
          assumeRoleArn: 'bloop:here:123456789012',
          assumeRoleExternalId: undefined,
        },
      );
    });

    test('dont lookup bootstrap version parameter if default credentials are used', async () => {
      // GIVEN
      mockForEnvironment = jest.fn().mockImplementation(() => {
        return { sdk: mockSdk, didAssumeRole: false };
      });
      mockCloudExecutable.sdkProvider.forEnvironment = mockForEnvironment;
      const cdkToolkit = new CdkToolkit({
        ioHost,
        cloudExecutable: mockCloudExecutable,
        configuration: mockCloudExecutable.configuration,
        sdkProvider: mockCloudExecutable.sdkProvider,
        deployments: new Deployments({
          sdkProvider: mockCloudExecutable.sdkProvider,
          ioHelper,
        }),
      });

      // WHEN
      await cdkToolkit.deploy({
        selector: { patterns: ['Test-Stack-C'] },
        deploymentMethod: { method: 'change-set' },
      });

      // THEN
      expect(flatten(notifySpy.mock.calls)).toEqual(
        expect.arrayContaining([
          expectIoMsg(expect.stringMatching(/Lookup role.*was not assumed. Proceeding with default credentials./)),
        ]),
      );
      expect(mockSSMClient).not.toHaveReceivedAnyCommand();
      expect(mockForEnvironment).toHaveBeenNthCalledWith(
        1,
        {
          account: '123456789012',
          name: 'aws://123456789012/here',
          region: 'here',
        },
        Mode.ForReading,
        {
          assumeRoleArn: 'bloop-lookup:here:123456789012',
          assumeRoleExternalId: undefined,
        },
      );
      expect(mockForEnvironment).toHaveBeenNthCalledWith(
        2,
        {
          account: '123456789012',
          name: 'aws://123456789012/here',
          region: 'here',
        },
        Mode.ForWriting,
        {
          assumeRoleArn: 'bloop:here:123456789012',
          assumeRoleExternalId: undefined,
        },
      );
    });

    test('do not print warnings if lookup role not provided in stack artifact', async () => {
      // GIVEN
      const cdkToolkit = new CdkToolkit({
        ioHost,
        cloudExecutable: mockCloudExecutable,
        configuration: mockCloudExecutable.configuration,
        sdkProvider: mockCloudExecutable.sdkProvider,
        deployments: new Deployments({
          sdkProvider: mockCloudExecutable.sdkProvider,
          ioHelper,
        }),
      });

      // WHEN
      await cdkToolkit.deploy({
        selector: { patterns: ['Test-Stack-A'] },
        deploymentMethod: { method: 'change-set' },
      });

      // THEN
      expect(flatten(notifySpy.mock.calls)).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Could not assume/),
          expect.stringMatching(/please upgrade to bootstrap version/),
        ]),
      );
      expect(mockSSMClient).not.toHaveReceivedAnyCommand();
      expect(mockForEnvironment).toHaveBeenCalledTimes(2);
      expect(mockForEnvironment).toHaveBeenNthCalledWith(
        1,
        {
          account: '123456789012',
          name: 'aws://123456789012/here',
          region: 'here',
        },
        0,
        {
          assumeRoleArn: undefined,
          assumeRoleExternalId: undefined,
        },
      );
      expect(mockForEnvironment).toHaveBeenNthCalledWith(
        2,
        {
          account: '123456789012',
          name: 'aws://123456789012/here',
          region: 'here',
        },
        1,
        {
          assumeRoleArn: 'bloop:here:123456789012',
          assumeRoleExternalId: undefined,
        },
      );
    });
  });

  test('can set progress via options', async () => {
    // Ensure environment allows StackActivityProgress.BAR
    ioHost.stackProgress = StackActivityProgress.BAR;
    ioHost.isTTY = true;
    ioHost.isCI = false;
    expect(ioHost.stackProgress).toBe('bar');

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: new FakeCloudFormation({}),
    });

    // check this hasn't changed yet
    expect(ioHost.stackProgress).toBe('bar');

    await toolkit.deploy({
      progress: StackActivityProgress.EVENTS,
      selector: { patterns: ['**'] },
      deploymentMethod: {
        method: 'hotswap',
        fallback: { method: 'change-set' },
      },
    });

    // now expect it to be updated
    expect(ioHost.stackProgress).toBe('events');
  });
});

describe('destroy', () => {
  test('destroy correct stack', async () => {
    const toolkit = defaultToolkitSetup();

    expect(() => {
      return toolkit.destroy({
        selector: { patterns: ['Test-Stack-A/Test-Stack-C'] },
        exclusively: true,
        force: true,
        fromDeploy: true,
      });
    }).resolves;
  });

  test('can destroy nested stack with wildcard pattern', async () => {
    const toolkit = defaultToolkitSetup();

    expect(() => {
      return toolkit.destroy({
        selector: { patterns: ['Test*/*'] },
        exclusively: true,
        force: true,
        fromDeploy: true,
      });
    }).resolves;
  });

  test('can destroy nested stack in nested-only configuration', async () => {
    // only nested stacks (no top-level stacks)
    const nestedOnlyExecutable = await MockCloudExecutable.create({
      stacks: [],
      nestedAssemblies: [
        {
          stacks: [MockStack.MOCK_STACK_C],
        },
      ],
    });

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable: nestedOnlyExecutable,
      configuration: nestedOnlyExecutable.configuration,
      sdkProvider: nestedOnlyExecutable.sdkProvider,
      deployments: new FakeCloudFormation({
        'Test-Stack-C': { Baz: 'Zinga!' },
      }),
    });

    expect(() => {
      return toolkit.destroy({
        selector: { patterns: ['Test-Stack-A/Test-Stack-C'] },
        exclusively: true,
        force: true,
        fromDeploy: true,
      });
    }).resolves;
  });

  test('can destroy with --all flag', async () => {
    const toolkit = defaultToolkitSetup();

    expect(() => {
      return toolkit.destroy({
        selector: { patterns: [] }, // --all flag uses empty patterns
        exclusively: true,
        force: true,
        fromDeploy: true,
      });
    }).resolves;
  });

  test('can destroy with --all flag in nested-only configuration', async () => {
    const nestedOnlyExecutable = await MockCloudExecutable.create({
      stacks: [],
      nestedAssemblies: [{
        stacks: [
          MockStack.MOCK_STACK_C,
        ],
      }],
    });

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable: nestedOnlyExecutable,
      configuration: nestedOnlyExecutable.configuration,
      sdkProvider: nestedOnlyExecutable.sdkProvider,
      deployments: new FakeCloudFormation({
        'Test-Stack-C': { Baz: 'Zinga!' },
      }),
    });

    expect(() => {
      return toolkit.destroy({
        selector: { patterns: [] }, // --all flag uses empty patterns
        exclusively: true,
        force: true,
        fromDeploy: true,
      });
    }).resolves;
  });

  test('does not throw and warns if there are only non-existent stacks', async () => {
    const toolkit = defaultToolkitSetup();

    await toolkit.destroy({
      selector: { patterns: ['Test-Stack-X', 'Test-Stack-Y'] },
      exclusively: true,
      force: true,
      fromDeploy: true,
    });

    expect(flatten(notifySpy.mock.calls)).toEqual([
      // Color codes are optional because chalk depends on TTY/TERM
      expectIoMsg(expect.stringMatching(/(\x1B\[31m)?Test-Stack-X(\x1B\[39m)? does not exist./), 'warn'),
      // Color codes are optional because chalk depends on TTY/TERM
      expectIoMsg(expect.stringMatching(/(\x1B\[31m)?Test-Stack-Y(\x1B\[39m)? does not exist./), 'warn'),
      // Color codes are optional because chalk depends on TTY/TERM
      expectIoMsg(expect.stringMatching(/No stacks match the name\(s\): (\x1B\[31m)?Test-Stack-X, Test-Stack-Y(\x1B\[39m)?/), 'warn'),
    ]);
  });

  test('does not throw and warns if there is a non-existent stack and the other exists', async () => {
    const toolkit = defaultToolkitSetup();

    await toolkit.destroy({
      selector: { patterns: ['Test-Stack-X', 'Test-Stack-B'] },
      exclusively: true,
      force: true,
      fromDeploy: true,
    });

    expect(flatten(notifySpy.mock.calls)).toEqual(
      expect.arrayContaining([
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/(\x1B\[31m)?Test-Stack-X(\x1B\[39m)? does not exist./), 'warn'),
      ]),
    );
    expect(flatten(notifySpy.mock.calls)).not.toEqual(
      expect.arrayContaining([
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/(\x1B\[31m)?Test-Stack-B(\x1B\[39m)? does not exist./), 'warn'),
      ]),
    );
    expect(flatten(notifySpy.mock.calls)).not.toEqual(
      expect.arrayContaining([
        expectIoMsg(expect.stringMatching(/No stacks match the name\(s\)/), 'warn'),
      ]),
    );
  });

  test('does not throw and suggests valid names if there is a non-existent but closely matching stack', async () => {
    const toolkit = defaultToolkitSetup();

    await toolkit.destroy({
      selector: { patterns: ['test-stack-b'] },
      exclusively: true,
      force: true,
      fromDeploy: true,
    });

    expect(flatten(notifySpy.mock.calls)).toEqual(
      expect.arrayContaining([
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/(\x1B\[31m)?test-stack-b(\x1B\[39m)? does not exist. Do you mean (\x1B\[34m)?Test-Stack-B(\x1B\[39m)?/), 'warn'),
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/No stacks match the name\(s\): (\x1B\[31m)?test-stack-b(\x1B\[39m)?/), 'warn'),
      ]),
    );
  });

  test('does not throw and suggests nested stack names if there is a non-existent but closely matching nested stack', async () => {
    const toolkit = defaultToolkitSetup();

    await toolkit.destroy({
      selector: { patterns: ['test-stack-a/test-stack-c'] },
      exclusively: true,
      force: true,
      fromDeploy: true,
    });

    expect(flatten(notifySpy.mock.calls)).toEqual(
      expect.arrayContaining([
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/(\x1B\[31m)?test-stack-a\/test-stack-c(\x1B\[39m)? does not exist. Do you mean (\x1B\[34m)?Test-Stack-A\/Test-Stack-C(\x1B\[39m)?/), 'warn'),
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/No stacks match the name\(s\): (\x1B\[31m)?test-stack-a\/test-stack-c(\x1B\[39m)?/), 'warn'),
      ]),
    );
  });

  test('does not throw and does not suggest nested stack when pattern lacks hierarchy', async () => {
    const toolkit = defaultToolkitSetup();

    await toolkit.destroy({
      selector: { patterns: ['test-stack-c'] },
      exclusively: true,
      force: true,
      fromDeploy: true,
    });

    expect(flatten(notifySpy.mock.calls)).toEqual(
      expect.arrayContaining([
        // Color codes are optional because chalk depends on TTY/TERM
        // Should NOT suggest Test-Stack-A/Test-Stack-C because pattern lacks hierarchy
        expectIoMsg(expect.stringMatching(/(\x1B\[31m)?test-stack-c(\x1B\[39m)? does not exist\.$/), 'warn'),
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/No stacks match the name\(s\): (\x1B\[31m)?test-stack-c(\x1B\[39m)?/), 'warn'),
      ]),
    );
  });

  test('does not throw and warns when wildcard pattern does not match any stacks', async () => {
    const toolkit = defaultToolkitSetup();

    await toolkit.destroy({
      selector: { patterns: ['Foo*/*'] },
      exclusively: true,
      force: true,
      fromDeploy: true,
    });

    expect(flatten(notifySpy.mock.calls)).toEqual(
      expect.arrayContaining([
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/(\x1B\[31m)?Foo\*\/\*(\x1B\[39m)? does not exist\.$/), 'warn'),
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/No stacks match the name\(s\): (\x1B\[31m)?Foo\*\/\*(\x1B\[39m)?/), 'warn'),
      ]),
    );
  });

  test('does not throw and suggests stack with wildcard pattern when only case differs', async () => {
    const toolkit = defaultToolkitSetup();

    await toolkit.destroy({
      selector: { patterns: ['test*/*'] },
      exclusively: true,
      force: true,
      fromDeploy: true,
    });

    expect(flatten(notifySpy.mock.calls)).toEqual(
      expect.arrayContaining([
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/(\x1B\[31m)?test\*\/\*(\x1B\[39m)? does not exist\. Do you mean (\x1B\[34m)?Test-Stack-A\/Test-Stack-C(\x1B\[39m)?/), 'warn'),
      ]),
    );
  });

  test('does not throw and warns when destroying non-existent stack in nested-only configuration', async () => {
    // only nested stacks (no top-level stacks)
    const nestedOnlyExecutable = await MockCloudExecutable.create({
      stacks: [],
      nestedAssemblies: [
        {
          stacks: [MockStack.MOCK_STACK_C],
        },
      ],
    });

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable: nestedOnlyExecutable,
      configuration: nestedOnlyExecutable.configuration,
      sdkProvider: nestedOnlyExecutable.sdkProvider,
      deployments: new FakeCloudFormation({
        'Test-Stack-C': { Baz: 'Zinga!' },
      }),
    });

    await toolkit.destroy({
      selector: { patterns: ['Test-Stack-X'] },
      exclusively: true,
      force: true,
      fromDeploy: true,
    });

    expect(flatten(notifySpy.mock.calls)).toEqual(
      expect.arrayContaining([
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/(\x1B\[31m)?Test-Stack-X(\x1B\[39m)? does not exist./), 'warn'),
        // Color codes are optional because chalk depends on TTY/TERM
        expectIoMsg(expect.stringMatching(/No stacks match the name\(s\): (\x1B\[31m)?Test-Stack-X(\x1B\[39m)?/), 'warn'),
      ]),
    );
  });
});

describe('watch', () => {
  test("fails when no 'watch' settings are found", async () => {
    const toolkit = defaultToolkitSetup();

    await expect(() => {
      return toolkit.watch({
        selector: { patterns: [] },
        deploymentMethod: { method: 'hotswap' },
      });
    }).rejects.toThrow(
      "Cannot use the 'watch' command without specifying at least one directory to monitor. " +
      'Make sure to add a "watch" key to your cdk.json',
    );
  });

  test('observes only the root directory by default', async () => {
    cloudExecutable.configuration.settings.set(['watch'], {});
    const toolkit = defaultToolkitSetup();

    await toolkit.watch({
      selector: { patterns: [] },
      deploymentMethod: { method: 'hotswap' },
    });

    const includeArgs = fakeChokidarWatch.includeArgs;
    expect(includeArgs.length).toBe(1);
  });

  test("allows providing a single string in 'watch.include'", async () => {
    cloudExecutable.configuration.settings.set(['watch'], {
      include: 'my-dir',
    });
    const toolkit = defaultToolkitSetup();

    await toolkit.watch({
      selector: { patterns: [] },
      deploymentMethod: { method: 'hotswap' },
    });

    expect(fakeChokidarWatch.includeArgs).toStrictEqual(['my-dir']);
  });

  test("allows providing an array of strings in 'watch.include'", async () => {
    cloudExecutable.configuration.settings.set(['watch'], {
      include: ['my-dir1', '**/my-dir2/*'],
    });
    const toolkit = defaultToolkitSetup();

    await toolkit.watch({
      selector: { patterns: [] },
      deploymentMethod: { method: 'hotswap' },
    });

    expect(fakeChokidarWatch.includeArgs).toStrictEqual(['my-dir1', '**/my-dir2/*']);
  });

  test('ignores the output dir, dot files, dot directories, and node_modules by default', async () => {
    cloudExecutable.configuration.settings.set(['watch'], {});
    cloudExecutable.configuration.settings.set(['output'], 'cdk.out');
    const toolkit = defaultToolkitSetup();

    await toolkit.watch({
      selector: { patterns: [] },
      deploymentMethod: { method: 'hotswap' },
    });

    expect(fakeChokidarWatch.excludeArgs).toStrictEqual(['cdk.out/**', '**/.*', '**/.*/**', '**/node_modules/**']);
  });

  test("allows providing a single string in 'watch.exclude'", async () => {
    cloudExecutable.configuration.settings.set(['watch'], {
      exclude: 'my-dir',
    });
    const toolkit = defaultToolkitSetup();

    await toolkit.watch({
      selector: { patterns: [] },
      deploymentMethod: { method: 'hotswap' },
    });

    const excludeArgs = fakeChokidarWatch.excludeArgs;
    expect(excludeArgs.length).toBe(5);
    expect(excludeArgs[0]).toBe('my-dir');
  });

  test("allows providing an array of strings in 'watch.exclude'", async () => {
    cloudExecutable.configuration.settings.set(['watch'], {
      exclude: ['my-dir1', '**/my-dir2'],
    });
    const toolkit = defaultToolkitSetup();

    await toolkit.watch({
      selector: { patterns: [] },
      deploymentMethod: { method: 'hotswap' },
    });

    const excludeArgs = fakeChokidarWatch.excludeArgs;
    expect(excludeArgs.length).toBe(6);
    expect(excludeArgs[0]).toBe('my-dir1');
    expect(excludeArgs[1]).toBe('**/my-dir2');
  });

  test('allows watching with deploy concurrency', async () => {
    cloudExecutable.configuration.settings.set(['watch'], {});
    const toolkit = defaultToolkitSetup();
    const cdkDeployMock = jest.fn();
    toolkit.deploy = cdkDeployMock;

    await toolkit.watch({
      selector: { patterns: [] },
      concurrency: 3,
      deploymentMethod: { method: 'hotswap' },
    });
    await fakeChokidarWatcherOn.readyCallback();

    expect(cdkDeployMock).toHaveBeenCalledWith(expect.objectContaining({ concurrency: 3 }));
  });

  describe.each<[string, DeploymentMethod]>([
    ['hotswap-only', { method: 'hotswap' }],
    ['fallback', { method: 'hotswap', fallback: { method: 'change-set' } }],
  ])('%s mode', (_desc, deploymentMethod) => {
    test('passes through the correct hotswap mode to deployStack()', async () => {
      cloudExecutable.configuration.settings.set(['watch'], {});
      const toolkit = defaultToolkitSetup();
      const cdkDeployMock = jest.fn();
      toolkit.deploy = cdkDeployMock;

      await toolkit.watch({
        selector: { patterns: [] },
        deploymentMethod,
      });
      await fakeChokidarWatcherOn.readyCallback();

      expect(cdkDeployMock).toHaveBeenCalledWith(expect.objectContaining({ deploymentMethod }));
    });
  });

  test('respects hotswap only', async () => {
    cloudExecutable.configuration.settings.set(['watch'], {});
    const toolkit = defaultToolkitSetup();
    const cdkDeployMock = jest.fn();
    toolkit.deploy = cdkDeployMock;

    await toolkit.watch({
      selector: { patterns: [] },
      deploymentMethod: { method: 'hotswap' },
    });
    await fakeChokidarWatcherOn.readyCallback();

    expect(cdkDeployMock).toHaveBeenCalledWith(expect.objectContaining({ deploymentMethod: { method: 'hotswap' } }));
  });

  test('respects hotswap with fallback', async () => {
    cloudExecutable.configuration.settings.set(['watch'], {});
    const toolkit = defaultToolkitSetup();
    const cdkDeployMock = jest.fn();
    toolkit.deploy = cdkDeployMock;

    await toolkit.watch({
      selector: { patterns: [] },
      deploymentMethod: {
        method: 'hotswap',
        fallback: { method: 'change-set' },
      },
    });
    await fakeChokidarWatcherOn.readyCallback();

    expect(cdkDeployMock).toHaveBeenCalledWith(expect.objectContaining({
      deploymentMethod: {
        method: 'hotswap',
        fallback: { method: 'change-set' },
      },
    }));
  });

  test('respects full deployment (no hotswap)', async () => {
    cloudExecutable.configuration.settings.set(['watch'], {});
    const toolkit = defaultToolkitSetup();
    const cdkDeployMock = jest.fn();
    toolkit.deploy = cdkDeployMock;

    await toolkit.watch({
      selector: { patterns: [] },
      deploymentMethod: { method: 'change-set' },
    });
    await fakeChokidarWatcherOn.readyCallback();

    expect(cdkDeployMock).toHaveBeenCalledWith(expect.objectContaining({ deploymentMethod: { method: 'change-set' } }));
    expect(cdkDeployMock).not.toHaveBeenCalledWith(expect.objectContaining({ hotswap: expect.anything() }));
  });

  describe('with file change events', () => {
    let toolkit: CdkToolkit;
    let cdkDeployMock: jest.Mock;

    beforeEach(async () => {
      cloudExecutable.configuration.settings.set(['watch'], {});
      toolkit = defaultToolkitSetup();
      cdkDeployMock = jest.fn();
      toolkit.deploy = cdkDeployMock;
      await toolkit.watch({
        selector: { patterns: [] },
        deploymentMethod: { method: 'hotswap' },
      });
    });

    test("does not trigger a 'deploy' before the 'ready' event has fired", async () => {
      await fakeChokidarWatcherOn.fileEventCallback('add', 'my-file');

      expect(cdkDeployMock).not.toHaveBeenCalled();
    });

    describe("when the 'ready' event has already fired", () => {
      beforeEach(async () => {
        // The ready callback triggers a deployment so each test
        // that uses this function will see 'cdkDeployMock' called
        // an additional time.
        await fakeChokidarWatcherOn.readyCallback();
      });

      test("an initial 'deploy' is triggered, without any file changes", async () => {
        expect(cdkDeployMock).toHaveBeenCalledTimes(1); // from ready event
      });

      test("does trigger a 'deploy' for a file change", async () => {
        await fakeChokidarWatcherOn.fileEventCallback('add', 'my-file');

        expect(cdkDeployMock).toHaveBeenCalledTimes(
          1 // from ready event
          + 1, // from file event
        );
      });

      test("triggers a 'deploy' twice for two file changes", async () => {
        // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
        await Promise.all([
          fakeChokidarWatcherOn.fileEventCallback('add', 'my-file1'),
          fakeChokidarWatcherOn.fileEventCallback('change', 'my-file2'),
        ]);

        expect(cdkDeployMock).toHaveBeenCalledTimes(
          1 // from ready event
          + 2, // from file events
        );
      });

      test("batches file changes that happen during 'deploy'", async () => {
        // The next time a deployment is triggered, we want to simulate the deployment
        // taking some time, so we can queue up additional file changes.
        const deployment = promiseWithResolvers<void>();
        cdkDeployMock.mockImplementationOnce(() => {
          return deployment.promise;
        });

        // Send the initial file event, this will start the deployment.
        // We don't await this here, since we will finish the deployment after
        // other events have been queued up.
        const firstEvent = fakeChokidarWatcherOn.fileEventCallback('add', 'my-file1');

        // We need to wait a few event loop cycles here, before additional events
        // are send. If we don't, the callback for these events will be executed
        // before we even have started the deployment. And that means the latch is still
        // open. In reality, file events will come with a delay anyway.
        await new Promise(r => setTimeout(r, 10));

        // Next we simulate more file events.
        // Because the deployment is still ongoing they will be queued.
        const otherEvents = [
          fakeChokidarWatcherOn.fileEventCallback('change', 'my-file2'),
          fakeChokidarWatcherOn.fileEventCallback('unlink', 'my-file3'),
          fakeChokidarWatcherOn.fileEventCallback('add', 'my-file4'),
        ];

        // Now complete the initial deployment.
        // Because we are in the queued state, this will kick-off an other deployment.
        deployment.resolve();

        // Then wait for all events to complete so we can assert how often deploy was called
        // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
        await Promise.all([firstEvent, ...otherEvents]);

        expect(cdkDeployMock).toHaveBeenCalledTimes(
          1 // from ready event
          + 1 // from first add event
          + 1, // from the queued events
        );
      });
    });
  });
});

describe('synth', () => {
  test('successful synth outputs hierarchical stack ids', async () => {
    const toolkit = defaultToolkitSetup();
    await toolkit.synth([], false, false);

    // Separate tests as colorizing hampers detection
    expect(notifySpy.mock.calls[1][0].message).toMatch('Test-Stack-A-Display-Name');
    expect(notifySpy.mock.calls[1][0].message).toMatch('Test-Stack-B');
  });

  test('with no stdout option', async () => {
    // GIVE
    const toolkit = defaultToolkitSetup();

    // THEN
    await toolkit.synth(['Test-Stack-A-Display-Name'], false, true);
    expect(notifySpy.mock.calls.length).toEqual(0);
  });

  describe('stack with error and flagged for validation', () => {
    beforeEach(async () => {
      cloudExecutable = await MockCloudExecutable.create({
        stacks: [MockStack.MOCK_STACK_A, MockStack.MOCK_STACK_B],
        nestedAssemblies: [
          {
            stacks: [
              {
                properties: { validateOnSynth: true },
                ...MockStack.MOCK_STACK_WITH_ERROR,
              },
            ],
          },
        ],
      });
    });

    test('causes synth to fail if autoValidate=true', async () => {
      const toolkit = defaultToolkitSetup();
      const autoValidate = true;
      await expect(toolkit.synth([], false, true, autoValidate)).rejects.toBeDefined();
    });

    test('causes synth to succeed if autoValidate=false', async () => {
      const toolkit = defaultToolkitSetup();
      const autoValidate = false;
      await toolkit.synth([], false, true, autoValidate);
      expect(notifySpy.mock.calls.filter(([msg]) => msg.level === 'result').length).toBe(0);
    });
  });

  test('stack has error and was explicitly selected', async () => {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [MockStack.MOCK_STACK_A, MockStack.MOCK_STACK_B],
      nestedAssemblies: [
        {
          stacks: [
            {
              properties: { validateOnSynth: false },
              ...MockStack.MOCK_STACK_WITH_ERROR,
            },
          ],
        },
      ],
    });

    const toolkit = defaultToolkitSetup();

    await expect(toolkit.synth(['Test-Stack-A/witherrors'], false, true)).rejects.toBeDefined();
  });

  test('stack has error, is not flagged for validation and was not explicitly selected', async () => {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [MockStack.MOCK_STACK_A, MockStack.MOCK_STACK_B],
      nestedAssemblies: [
        {
          stacks: [
            {
              properties: { validateOnSynth: false },
              ...MockStack.MOCK_STACK_WITH_ERROR,
            },
          ],
        },
      ],
    });

    const toolkit = defaultToolkitSetup();

    await toolkit.synth([], false, true);
  });

  test('stack has dependency and was explicitly selected', async () => {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [MockStack.MOCK_STACK_C, MockStack.MOCK_STACK_D],
    });

    const toolkit = defaultToolkitSetup();

    await toolkit.synth([MockStack.MOCK_STACK_D.stackName], true, false);

    expect(notifySpy.mock.calls.length).toEqual(1);
    expect(notifySpy.mock.calls[0][0]).toBeDefined();
  });
});

describe('migrate', () => {
  const testResourcePath = [__dirname, '..', 'commands', 'test-resources'];
  const templatePath = [...testResourcePath, 'templates'];
  const sqsTemplatePath = path.join(...templatePath, 'sqs-template.json');
  const autoscalingTemplatePath = path.join(...templatePath, 'autoscaling-template.yml');
  const s3TemplatePath = path.join(...templatePath, 's3-template.json');

  test('migrate fails when both --from-path and --from-stack are provided', async () => {
    const toolkit = defaultToolkitSetup();
    await expect(() =>
      toolkit.migrate({
        stackName: 'no-source',
        fromPath: './here/template.yml',
        fromStack: true,
      }),
    ).rejects.toThrow('Only one of `--from-path` or `--from-stack` may be provided.');
    expect(notifySpy.mock.calls[1][0].message).toContain(
      ' ❌  Migrate failed for `no-source`: Only one of `--from-path` or `--from-stack` may be provided.',
    );
  });

  test('migrate fails when --from-path is invalid', async () => {
    const toolkit = defaultToolkitSetup();
    await expect(() =>
      toolkit.migrate({
        stackName: 'bad-local-source',
        fromPath: './here/template.yml',
      }),
    ).rejects.toThrow("'./here/template.yml' is not a valid path.");
    expect(notifySpy.mock.calls[1][0].message).toContain(
      " ❌  Migrate failed for `bad-local-source`: './here/template.yml' is not a valid path.",
    );
  });

  test('migrate fails when --from-stack is used and stack does not exist in account', async () => {
    const mockSdkProvider = new MockSdkProvider();
    mockCloudFormationClient.on(DescribeStacksCommand).rejects(new Error('Stack does not exist in this environment'));

    const mockCloudExecutable = await MockCloudExecutable.create({
      stacks: [],
    });

    const cdkToolkit = new CdkToolkit({
      ioHost,
      cloudExecutable: mockCloudExecutable,
      deployments: new Deployments({
        sdkProvider: mockSdkProvider,
        ioHelper: asIoHelper(CliIoHost.instance(), 'deploy'),
      }),
      sdkProvider: mockSdkProvider,
      configuration: mockCloudExecutable.configuration,
    });

    await expect(() =>
      cdkToolkit.migrate({
        stackName: 'bad-cloudformation-source',
        fromStack: true,
      }),
    ).rejects.toThrow('Stack does not exist in this environment');
    expect(notifySpy.mock.calls[1][0].message).toContain(
      ' ❌  Migrate failed for `bad-cloudformation-source`: Stack does not exist in this environment',
    );
  });

  test('migrate fails when stack cannot be generated', async () => {
    const toolkit = defaultToolkitSetup();
    await expect(() =>
      toolkit.migrate({
        stackName: 'cannot-generate-template',
        fromPath: sqsTemplatePath,
        language: 'rust',
      }),
    ).rejects.toThrow(
      'CannotGenerateTemplateStack could not be generated because rust is not a supported language',
    );
    expect(notifySpy.mock.calls[1][0].message).toContain(
      ' ❌  Migrate failed for `cannot-generate-template`: CannotGenerateTemplateStack could not be generated because rust is not a supported language',
    );
  });

  cliTest('migrate succeeds for valid template from local path when no language is provided', async (workDir) => {
    const toolkit = defaultToolkitSetup();
    await toolkit.migrate({
      stackName: 'SQSTypeScript',
      fromPath: sqsTemplatePath,
      outputPath: workDir,
    });

    // Packages created for typescript
    expect(fs.pathExistsSync(path.join(workDir, 'SQSTypeScript', 'package.json'))).toBeTruthy();
    expect(fs.pathExistsSync(path.join(workDir, 'SQSTypeScript', 'bin', 'sqs_type_script.ts'))).toBeTruthy();
    expect(fs.pathExistsSync(path.join(workDir, 'SQSTypeScript', 'lib', 'sqs_type_script-stack.ts'))).toBeTruthy();
  });

  cliTest('migrate succeeds for valid template from local path when language is provided', async (workDir) => {
    const toolkit = defaultToolkitSetup();
    await toolkit.migrate({
      stackName: 'S3Python',
      fromPath: s3TemplatePath,
      outputPath: workDir,
      language: 'python',
    });

    // Packages created for typescript
    expect(fs.pathExistsSync(path.join(workDir, 'S3Python', 'requirements.txt'))).toBeTruthy();
    expect(fs.pathExistsSync(path.join(workDir, 'S3Python', 'app.py'))).toBeTruthy();
    expect(fs.pathExistsSync(path.join(workDir, 'S3Python', 's3_python', 's3_python_stack.py'))).toBeTruthy();
  });

  cliTest('migrate call is idempotent', async (workDir) => {
    const toolkit = defaultToolkitSetup();
    await toolkit.migrate({
      stackName: 'AutoscalingCSharp',
      fromPath: autoscalingTemplatePath,
      outputPath: workDir,
      language: 'csharp',
    });

    // Packages created for typescript
    expect(fs.pathExistsSync(path.join(workDir, 'AutoscalingCSharp', 'src', 'AutoscalingCSharp.sln'))).toBeTruthy();
    expect(
      fs.pathExistsSync(path.join(workDir, 'AutoscalingCSharp', 'src', 'AutoscalingCSharp', 'Program.cs')),
    ).toBeTruthy();
    expect(
      fs.pathExistsSync(
        path.join(workDir, 'AutoscalingCSharp', 'src', 'AutoscalingCSharp', 'AutoscalingCSharpStack.cs'),
      ),
    ).toBeTruthy();

    // One more time
    await toolkit.migrate({
      stackName: 'AutoscalingCSharp',
      fromPath: autoscalingTemplatePath,
      outputPath: workDir,
      language: 'csharp',
    });

    // Packages created for typescript
    expect(fs.pathExistsSync(path.join(workDir, 'AutoscalingCSharp', 'src', 'AutoscalingCSharp.sln'))).toBeTruthy();
    expect(
      fs.pathExistsSync(path.join(workDir, 'AutoscalingCSharp', 'src', 'AutoscalingCSharp', 'Program.cs')),
    ).toBeTruthy();
    expect(
      fs.pathExistsSync(
        path.join(workDir, 'AutoscalingCSharp', 'src', 'AutoscalingCSharp', 'AutoscalingCSharpStack.cs'),
      ),
    ).toBeTruthy();
  });
});

describe('rollback', () => {
  test('rollback uses deployment role', async () => {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [MockStack.MOCK_STACK_C],
    });

    const mockedRollback = jest.spyOn(Deployments.prototype, 'rollbackStack').mockResolvedValue({
      success: true,
      stackArn: 'arn',
    });

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: new Deployments({
        sdkProvider: new MockSdkProvider(),
        ioHelper,
      }),
    });

    await toolkit.rollback({
      selector: { patterns: [] },
    });

    expect(mockedRollback).toHaveBeenCalled();
  });

  // testing rollback inside deploy
  test.each([
    [{ type: 'failpaused-need-rollback-first', reason: 'replacement', status: 'OOPS' }, false],
    [{ type: 'failpaused-need-rollback-first', reason: 'replacement', status: 'OOPS' }, true],
    [{ type: 'failpaused-need-rollback-first', reason: 'not-norollback', status: 'OOPS' }, false],
    [{ type: 'replacement-requires-rollback' }, false],
    [{ type: 'replacement-requires-rollback' }, true],
  ] satisfies Array<[DeployStackResult, boolean]>)('no-rollback deployment that cant proceed will be called with rollback on retry: %p (using force: %p)', async (firstResult, useForce) => {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        MockStack.MOCK_STACK_C,
      ],
    });

    const deployments = new Deployments({
      sdkProvider: new MockSdkProvider(),
      ioHelper,
    });

    // Rollback might be called -- just don't do anything.
    const mockRollbackStack = jest.spyOn(deployments, 'rollbackStack').mockResolvedValue({ success: true, stackArn: 'arn' });

    const mockedDeployStack = jest
      .spyOn(deployments, 'deployStack')
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce({
        type: 'did-deploy-stack',
        noOp: false,
        outputs: {},
        stackArn: 'stack:arn',
      });

    // respond with yes
    requestSpy.mockImplementationOnce(async () => true);

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments,
    });

    await toolkit.deploy({
      selector: { patterns: [] },
      deploymentMethod: { method: 'change-set' },
      rollback: false,
      requireApproval: RequireApproval.NEVER,
      force: useForce,
    });

    if (firstResult.type === 'failpaused-need-rollback-first') {
      expect(mockRollbackStack).toHaveBeenCalled();
    }

    if (!useForce) {
      // Questions will have been asked only if --force is not specified
      if (firstResult.type === 'failpaused-need-rollback-first') {
        expect(requestSpy).toHaveBeenCalledWith(expectIoMsg(expect.stringContaining('Roll back first and then proceed with deployment')));
      } else {
        expect(requestSpy).toHaveBeenCalledWith(expectIoMsg(expect.stringContaining('Perform a regular deployment')));
      }
    }

    expect(mockedDeployStack).toHaveBeenNthCalledWith(1, expect.objectContaining({ rollback: false }));
    expect(mockedDeployStack).toHaveBeenNthCalledWith(2, expect.objectContaining({ rollback: true }));
  });
});

class MockStack {
  public static readonly MOCK_STACK_A: TestStackArtifact = {
    stackName: 'Test-Stack-A',
    template: { Resources: { TemplateName: 'Test-Stack-A' } },
    env: 'aws://123456789012/bermuda-triangle-1',
    metadata: {
      '/Test-Stack-A': [
        {
          type: cxschema.ArtifactMetadataEntryType.STACK_TAGS,
          data: [{ key: 'Foo', value: 'Bar' }],
        },
      ],
    },
    displayName: 'Test-Stack-A-Display-Name',
  };
  public static readonly MOCK_STACK_B: TestStackArtifact = {
    stackName: 'Test-Stack-B',
    template: { Resources: { TemplateName: 'Test-Stack-B' } },
    env: 'aws://123456789012/bermuda-triangle-1',
    metadata: {
      '/Test-Stack-B': [
        {
          type: cxschema.ArtifactMetadataEntryType.STACK_TAGS,
          data: [{ key: 'Baz', value: 'Zinga!' }],
        },
      ],
    },
  };
  public static readonly MOCK_STACK_C: TestStackArtifact = {
    stackName: 'Test-Stack-C',
    template: { Resources: { TemplateName: 'Test-Stack-C' } },
    env: 'aws://123456789012/bermuda-triangle-1',
    metadata: {
      '/Test-Stack-C': [
        {
          type: cxschema.ArtifactMetadataEntryType.STACK_TAGS,
          data: [{ key: 'Baz', value: 'Zinga!' }],
        },
      ],
    },
    displayName: 'Test-Stack-A/Test-Stack-C',
  };
  public static readonly MOCK_STACK_D: TestStackArtifact = {
    stackName: 'Test-Stack-D',
    template: { Resources: { TemplateName: 'Test-Stack-D' } },
    env: 'aws://123456789012/bermuda-triangle-1',
    metadata: {
      '/Test-Stack-D': [
        {
          type: cxschema.ArtifactMetadataEntryType.STACK_TAGS,
          data: [{ key: 'Baz', value: 'Zinga!' }],
        },
      ],
    },
    depends: [MockStack.MOCK_STACK_C.stackName],
  };
  public static readonly MOCK_STACK_WITH_ERROR: TestStackArtifact = {
    stackName: 'witherrors',
    env: 'aws://123456789012/bermuda-triangle-1',
    template: { resource: 'errorresource' },
    metadata: {
      '/resource': [
        {
          type: cxschema.ArtifactMetadataEntryType.ERROR,
          data: 'this is an error',
        },
      ],
    },
    displayName: 'Test-Stack-A/witherrors',
  };
  public static readonly MOCK_STACK_WITH_ASSET: TestStackArtifact = {
    stackName: 'Test-Stack-Asset',
    template: { Resources: { TemplateName: 'Test-Stack-Asset' } },
    env: 'aws://123456789012/bermuda-triangle-1',
    assetManifest: {
      version: Manifest.version(),
      files: {
        xyz: {
          displayName: 'Asset Display Name',
          source: {
            path: path.resolve(__dirname, '..', '..', 'LICENSE'),
          },
          destinations: {
            desto: {
              bucketName: 'some-bucket',
              objectKey: 'some-key',
            },
          },
        },
      },
    },
  };
  public static readonly MOCK_STACK_WITH_NOTIFICATION_ARNS: TestStackArtifact = {
    stackName: 'Test-Stack-Notification-Arns',
    notificationArns: ['arn:aws:sns:bermuda-triangle-1337:123456789012:MyTopic'],
    template: { Resources: { TemplateName: 'Test-Stack-Notification-Arns' } },
    env: 'aws://123456789012/bermuda-triangle-1337',
    metadata: {
      '/Test-Stack-Notification-Arns': [
        {
          type: cxschema.ArtifactMetadataEntryType.STACK_TAGS,
          data: [{ key: 'Foo', value: 'Bar' }],
        },
      ],
    },
  };

  public static readonly MOCK_STACK_WITH_BAD_NOTIFICATION_ARNS: TestStackArtifact = {
    stackName: 'Test-Stack-Bad-Notification-Arns',
    notificationArns: ['arn:1337:123456789012:sns:bad'],
    template: { Resources: { TemplateName: 'Test-Stack-Bad-Notification-Arns' } },
    env: 'aws://123456789012/bermuda-triangle-1337',
    metadata: {
      '/Test-Stack-Bad-Notification-Arns': [
        {
          type: cxschema.ArtifactMetadataEntryType.STACK_TAGS,
          data: [{ key: 'Foo', value: 'Bar' }],
        },
      ],
    },
  };
}

class FakeCloudFormation extends Deployments {
  private readonly expectedTags: { [stackName: string]: Tag[] } = {};
  private readonly expectedNotificationArns?: string[];

  constructor(
    expectedTags: { [stackName: string]: { [key: string]: string } } = {},
    expectedNotificationArns?: string[],
  ) {
    super({
      sdkProvider: new MockSdkProvider(),
      ioHelper,
    });

    for (const [stackName, tags] of Object.entries(expectedTags)) {
      this.expectedTags[stackName] = Object.entries(tags)
        .map(([Key, Value]) => ({ Key, Value }))
        .sort((l, r) => l.Key.localeCompare(r.Key));
    }
    this.expectedNotificationArns = expectedNotificationArns;
  }

  public deployStack(options: DeployStackOptions): Promise<SuccessfulDeployStackResult> {
    expect([
      MockStack.MOCK_STACK_A.stackName,
      MockStack.MOCK_STACK_B.stackName,
      MockStack.MOCK_STACK_C.stackName,
      // MockStack.MOCK_STACK_D deliberately omitted.
      MockStack.MOCK_STACK_WITH_ASSET.stackName,
      MockStack.MOCK_STACK_WITH_ERROR.stackName,
      MockStack.MOCK_STACK_WITH_NOTIFICATION_ARNS.stackName,
      MockStack.MOCK_STACK_WITH_BAD_NOTIFICATION_ARNS.stackName,
    ]).toContain(options.stack.stackName);

    if (this.expectedTags[options.stack.stackName]) {
      expect(options.tags).toEqual(this.expectedTags[options.stack.stackName]);
    }

    // In these tests, we don't make a distinction here between `undefined` and `[]`.
    //
    // In tests `deployStack` itself we do treat `undefined` and `[]` differently,
    // and in `aws-cdk-lib` we emit them under different conditions. But this test
    // without normalization depends on a version of `aws-cdk-lib` that hasn't been
    // released yet.
    expect(options.notificationArns ?? []).toEqual(this.expectedNotificationArns ?? []);
    return Promise.resolve({
      type: 'did-deploy-stack',
      stackArn: `arn:aws:cloudformation:::stack/${options.stack.stackName}/MockedOut`,
      noOp: false,
      outputs: { StackName: options.stack.stackName },
      stackArtifact: options.stack,
    });
  }

  public rollbackStack(_options: RollbackStackOptions): Promise<RollbackStackResult> {
    return Promise.resolve({
      success: true,
      stackArn: 'arn',
    } satisfies RollbackStackResult);
  }

  public destroyStack(options: DestroyStackOptions): Promise<DestroyStackResult> {
    expect(options.stack).toBeDefined();
    return Promise.resolve({ stackArn: 'arn' });
  }

  public readCurrentTemplate(stack: cxapi.CloudFormationStackArtifact): Promise<Template> {
    switch (stack.stackName) {
      case MockStack.MOCK_STACK_A.stackName:
        return Promise.resolve({});
      case MockStack.MOCK_STACK_B.stackName:
        return Promise.resolve({});
      case MockStack.MOCK_STACK_C.stackName:
        return Promise.resolve({});
      case MockStack.MOCK_STACK_WITH_ASSET.stackName:
        return Promise.resolve({});
      case MockStack.MOCK_STACK_WITH_NOTIFICATION_ARNS.stackName:
        return Promise.resolve({});
      case MockStack.MOCK_STACK_WITH_BAD_NOTIFICATION_ARNS.stackName:
        return Promise.resolve({});
      default:
        throw new Error(`not an expected mock stack: ${stack.stackName}`);
    }
  }
}

function cliTest(name: string, handler: (dir: string) => void | Promise<any>): void {
  test(name, () => withTempDir(handler), 120000);
}

async function withTempDir(cb: (dir: string) => void | Promise<any>) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aws-cdk-test'));
  try {
    await cb(tmpDir);
  } finally {
    await fs.remove(tmpDir);
  }
}
