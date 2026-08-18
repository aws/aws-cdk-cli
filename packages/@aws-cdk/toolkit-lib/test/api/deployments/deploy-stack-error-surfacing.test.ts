import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import { deployStack } from '../../../lib/api/deployments/deploy-stack';
import type { DeployStackOptions as DeployStackApiOptions } from '../../../lib/api/deployments/deploy-stack';
import { CloudFormationStackDiagnoser } from '../../../lib/api/diagnosing/stack-diagnoser';
import { NoBootstrapStackEnvironmentResources } from '../../../lib/api/environment';
import { StackArtifactSourceTracer } from '../../../lib/api/source-tracing/private/stack-source-tracing';
import { ToolkitError } from '../../../lib/toolkit/toolkit-error';
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

jest.mock('../../../lib/api/deployments/checks', () => ({
  determineAllowCrossAccountAssetPublishing: jest.fn().mockResolvedValue(true),
}));

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper('deploy');

const FAILING_STACK = testStack({
  stackName: 'freshstack',
  template: {
    Resources: {
      Bad: {
        Type: 'Test::Fake::Resource',
        Properties: { Fail: true },
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
  restoreSdkMocksToDefault();
  fakeCfn.installUsingAwsMock(mockCloudFormationClient);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function standardDeployStackArguments(stack: CloudFormationStackArtifact): DeployStackApiOptions {
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

describe.each(['change-set', 'direct'] as const)('a failing %s deployment of a new stack', (method) => {
  test('reports the CloudFormation failure rather than an internal NoStack error', async () => {
    // GIVEN - a stack that does not exist yet, so the pre-deploy lookup holds no stack at all
    const deployment = advanceTime(deployStack({
      ...standardDeployStackArguments(FAILING_STACK),
      deploymentMethod: { method },
    }, ioHelper));

    // THEN - either the resource-level diagnosis or the status the stack ended up in, but something
    // that names the actual failure
    await expect(deployment).rejects.toThrow(/freshstack\/Bad|ROLLBACK_COMPLETE/);
    await expect(deployment).rejects.not.toThrow(/does not hold a stack/);
    await expect(deployment).rejects.toMatchObject({ name: 'DeploymentError' });
  });

  test('reports the CloudFormation failure when rollback is disabled', async () => {
    // GIVEN - without rollback the stack stays CREATE_FAILED rather than rolling back, reaching the
    // diagnoser through a different status
    const deployment = advanceTime(deployStack({
      ...standardDeployStackArguments(FAILING_STACK),
      deploymentMethod: { method },
      rollback: false,
    }, ioHelper));

    // THEN
    await expect(deployment).rejects.toThrow(/freshstack\/Bad|CREATE_FAILED/);
    await expect(deployment).rejects.not.toThrow(/does not hold a stack/);
  });
});

test('a failing update of an existing stack still reports the CloudFormation failure', async () => {
  // GIVEN - the same failure without the absent-stack path, guarding against a fix that only works
  // when the stack is missing
  fakeCfn.createStackSync({ StackName: 'freshstack' });

  // WHEN
  const deployment = advanceTime(deployStack({
    ...standardDeployStackArguments(FAILING_STACK),
    deploymentMethod: { method: 'change-set' },
  }, ioHelper));

  // THEN
  await expect(deployment).rejects.toThrow(/freshstack\/Bad|UPDATE_ROLLBACK_COMPLETE/);
  await expect(deployment).rejects.not.toThrow(/does not hold a stack/);
});

test('a failed lookup while diagnosing leaves the deployment error intact', async () => {
  // GIVEN - describing the deployed stack fails while we are trying to diagnose why the deployment
  // failed. Diagnosis is best-effort, so this must not replace the deployment error.
  const debugIoHost = new TestIoHost('debug');
  const realClient = sdk.cloudFormation();
  jest.spyOn(sdk, 'cloudFormation').mockReturnValue({
    ...realClient,
    describeStacks: async (input) => {
      if (input.StackName?.startsWith('arn:')) {
        throw new ToolkitError('Throttling', 'Rate exceeded');
      }
      return realClient.describeStacks(input);
    },
  });

  // WHEN
  const deployment = advanceTime(deployStack({
    ...standardDeployStackArguments(FAILING_STACK),
    deploymentMethod: { method: 'change-set' },
  }, debugIoHost.asHelper('deploy')));

  // THEN
  await expect(deployment).rejects.toThrow(/ROLLBACK_COMPLETE/);
  await expect(deployment).rejects.not.toThrow(/Rate exceeded/);
  await expect(deployment).rejects.toMatchObject({ name: 'DeploymentError' });

  // ...and the swallowed lookup failure is still visible to anyone debugging
  debugIoHost.expectMessage({ level: 'debug', containing: 'Rate exceeded' });
});
