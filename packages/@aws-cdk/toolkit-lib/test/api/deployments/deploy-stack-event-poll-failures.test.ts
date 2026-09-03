import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import { deployStack, destroyStack } from '../../../lib/api/deployments/deploy-stack';
import type { DeployStackOptions as DeployStackApiOptions } from '../../../lib/api/deployments/deploy-stack';
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
  ioHost.clear();

  sdkProvider = new MockSdkProvider();
  sdk = new MockSdk();

  restoreSdkMocksToDefault();
  fakeCfn.installUsingAwsMock(mockCloudFormationClient);

  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
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

/**
 * Throttle every stack event read, leaving the rest of the CloudFormation API working
 */
function throttleStackEventReads() {
  const realClient = sdk.cloudFormation();
  jest.spyOn(sdk, 'cloudFormation').mockReturnValue({
    ...realClient,
    describeStackEvents: () => Promise.reject(Object.assign(new Error('Rate exceeded'), { name: 'Throttling' })),
  });
}

describe.each(['change-set', 'direct'] as const)('a successful %s deployment', (method) => {
  test('is not failed by a throttled stack event poll', async () => {
    // GIVEN - reading stack events fails throughout, including the final poll in monitor.stop()
    throttleStackEventReads();

    // WHEN
    const result = await advanceTime(deployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: { method },
    }, ioHelper));

    // THEN - the deployment succeeded, and the final poll failure was only reported
    expect(result).toMatchObject({ type: 'did-deploy-stack' });
    ioHost.expectMessage({ level: 'warn', containing: 'Error occurred during final stack event poll' });
  });
});

test('a successful destroy is not failed by a throttled stack event poll', async () => {
  // GIVEN
  fakeCfn.createStackSync({ StackName: 'withouterrors' });
  throttleStackEventReads();

  // WHEN
  const result = await advanceTime(destroyStack({
    stack: FAKE_STACK,
    sdk,
  }, ioHelper));

  // THEN
  expect(result.stackArn).toBeDefined();
  ioHost.expectMessage({ level: 'warn', containing: 'Error occurred during final stack event poll' });
});
