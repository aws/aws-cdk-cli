import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import { deployStack, destroyStack } from '../../../lib/api/deployments/deploy-stack';
import type { DeployStackOptions as DeployStackApiOptions } from '../../../lib/api/deployments/deploy-stack';
import { CloudFormationStackDiagnoser } from '../../../lib/api/diagnosing/stack-diagnoser';
import { NoBootstrapStackEnvironmentResources } from '../../../lib/api/environment';
import { StackArtifactSourceTracer } from '../../../lib/api/source-tracing/private/stack-source-tracing';
import { StackActivityMonitor } from '../../../lib/api/stack-events';
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

jest.mock('../../../lib/api/stack-events', () => {
  const actual = jest.requireActual('../../../lib/api/stack-events');
  return {
    ...actual,
    StackActivityMonitor: jest.fn().mockImplementation((props) => new actual.StackActivityMonitor(props)),
  };
});

jest.mock('../../../lib/api/deployments/checks', () => ({
  determineAllowCrossAccountAssetPublishing: jest.fn().mockResolvedValue(true),
}));

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper('deploy');

const FAKE_STACK = testStack({
  stackName: 'withouterrors',
  template: {
    Resources: {
      MyResource: {
        Type: 'Test::Resource::Type',
        Properties: {
          Bar: 'Bar',
        },
      },
    },
  },
});

let sdk: MockSdk;
let sdkProvider: MockSdkProvider;
const fakeCfn = new FakeCloudFormation();

beforeEach(() => {
  fakeCfn.reset();

  sdkProvider = new MockSdkProvider();
  sdk = new MockSdk();
  sdk.getUrlSuffix = () => Promise.resolve('amazonaws.com');
  (StackActivityMonitor as unknown as jest.Mock).mockClear();

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

function monitorConstructorProps() {
  const calls = (StackActivityMonitor as unknown as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][0];
}

describe('deployStack', () => {
  test('passes stackEventPollingInterval to the StackActivityMonitor', async () => {
    // WHEN
    await advanceTime(deployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: { method: 'direct' },
      stackEventPollingInterval: 10_000,
    }, ioHelper));

    // THEN
    expect(monitorConstructorProps()).toEqual(expect.objectContaining({
      pollingInterval: 10_000,
    }));
  });

  test('monitor defaults to 2 second polling when stackEventPollingInterval is not set', async () => {
    // WHEN
    await advanceTime(deployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: { method: 'direct' },
    }, ioHelper));

    // THEN
    expect(monitorConstructorProps().pollingInterval).toBeUndefined();
    const monitor = (StackActivityMonitor as unknown as jest.Mock).mock.results[0].value;
    expect((monitor as any).pollingInterval).toEqual(2_000);
  });
});

describe('destroyStack', () => {
  test('passes stackEventPollingInterval to the StackActivityMonitor', async () => {
    // GIVEN
    fakeCfn.createStackSync({ StackName: 'withouterrors' });

    // WHEN
    await advanceTime(destroyStack({
      stack: FAKE_STACK,
      sdk,
      stackEventPollingInterval: 10_000,
    }, ioHelper));

    // THEN
    expect(monitorConstructorProps()).toEqual(expect.objectContaining({
      pollingInterval: 10_000,
    }));
  });

  test('monitor defaults to 2 second polling when stackEventPollingInterval is not set', async () => {
    // GIVEN
    fakeCfn.createStackSync({ StackName: 'withouterrors' });

    // WHEN
    await advanceTime(destroyStack({
      stack: FAKE_STACK,
      sdk,
    }, ioHelper));

    // THEN
    expect(monitorConstructorProps().pollingInterval).toBeUndefined();
    const monitor = (StackActivityMonitor as unknown as jest.Mock).mock.results[0].value;
    expect((monitor as any).pollingInterval).toEqual(2_000);
  });
});
