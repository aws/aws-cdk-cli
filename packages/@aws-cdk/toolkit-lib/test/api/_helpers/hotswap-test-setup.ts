import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import type { StackResourceSummary } from '@aws-sdk/client-cloudformation';
import { ListStackResourcesCommand, StackStatus } from '@aws-sdk/client-cloudformation';
import { GetFunctionCommand } from '@aws-sdk/client-lambda';
import { FakeCloudformationStack } from './fake-cloudformation-stack';
import type { ICloudFormationClient } from '../../../lib/api/aws-auth/private';
import type { Template } from '../../../lib/api/cloudformation';
import { CloudFormationStack } from '../../../lib/api/cloudformation';
import type { SuccessfulDeployStackResult } from '../../../lib/api/deployments/deployment-result';
import type { HotswapMode } from '../../../lib/api/hotswap';
import { HotswapPropertyOverrides, tryHotswapDeployment } from '../../../lib/api/hotswap';
import type { TestStackArtifact } from '../../_helpers/assembly';
import { testStack } from '../../_helpers/assembly';
import {
  mockCloudFormationClient,
  mockLambdaClient,
  MockSdkProvider,
  restoreSdkMocksToDefault,
  setDefaultSTSMocks,
} from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

const STACK_NAME = 'withouterrors';
export const STACK_ID = 'stackId';

let hotswapMockSdkProvider: HotswapMockSdkProvider;
let currentCfnStack: FakeCloudformationStack;
const currentCfnStackResources: StackResourceSummary[] = [];
let stackTemplates: { [stackName: string]: any };
let currentNestedCfnStackResources: { [stackName: string]: StackResourceSummary[] };
let ioHost = new TestIoHost();

export function setupHotswapTests(): HotswapMockSdkProvider {
  restoreSdkMocksToDefault();
  setDefaultSTSMocks();
  jest.resetAllMocks();
  // clear the array
  currentCfnStackResources.splice(0);
  hotswapMockSdkProvider = new HotswapMockSdkProvider();
  currentCfnStack = new FakeCloudformationStack({
    stackName: STACK_NAME,
    stackId: STACK_ID,
  });
  CloudFormationStack.lookup = async (_: ICloudFormationClient, _stackName: string) => {
    return currentCfnStack;
  };

  return hotswapMockSdkProvider;
}

export function setupHotswapNestedStackTests(rootStackName: string) {
  restoreSdkMocksToDefault();
  setDefaultSTSMocks();
  jest.resetAllMocks();
  currentNestedCfnStackResources = {};
  hotswapMockSdkProvider = new HotswapMockSdkProvider(rootStackName);
  currentCfnStack = new FakeCloudformationStack({
    stackName: rootStackName,
    stackId: STACK_ID,
  });
  stackTemplates = {};
  CloudFormationStack.lookup = async (_: ICloudFormationClient, stackName: string) => {
    currentCfnStack.template = async () => stackTemplates[stackName];
    return currentCfnStack;
  };

  return hotswapMockSdkProvider;
}

export function cdkStackArtifactOf(
  testStackArtifact: Partial<TestStackArtifact> = {},
): cxapi.CloudFormationStackArtifact {
  return testStack({
    stackName: STACK_NAME,
    ...testStackArtifact,
  });
}

export function pushStackResourceSummaries(...items: StackResourceSummary[]) {
  currentCfnStackResources.push(...items);
}

export function pushNestedStackResourceSummaries(stackName: string, ...items: StackResourceSummary[]) {
  if (!currentNestedCfnStackResources[stackName]) {
    currentNestedCfnStackResources[stackName] = [];
  }
  currentNestedCfnStackResources[stackName].push(...items);
}

export function setCurrentCfnStackTemplate(template: Template) {
  const templateDeepCopy = JSON.parse(JSON.stringify(template)); // deep copy the template, so our tests can mutate one template instead of creating two
  currentCfnStack.setTemplate(templateDeepCopy);
}

export function addTemplateToCloudFormationLookupMock(stackArtifact: cxapi.CloudFormationStackArtifact) {
  const templateDeepCopy = JSON.parse(JSON.stringify(stackArtifact.template)); // deep copy the template, so our tests can mutate one template instead of creating two
  stackTemplates[stackArtifact.stackName] = templateDeepCopy;
}

export function stackSummaryOf(
  logicalId: string,
  resourceType: string,
  physicalResourceId: string,
): StackResourceSummary {
  return {
    LogicalResourceId: logicalId,
    PhysicalResourceId: physicalResourceId,
    ResourceType: resourceType,
    ResourceStatus: StackStatus.CREATE_COMPLETE,
    LastUpdatedTimestamp: new Date(),
  };
}

export class HotswapMockSdkProvider extends MockSdkProvider {
  constructor(rootStackName?: string) {
    super();

    mockLambdaClient.on(GetFunctionCommand).resolves({
      Configuration: {
        LastUpdateStatus: 'Successful',
      },
    });

    mockCloudFormationClient.on(ListStackResourcesCommand).callsFake((input) => {
      if (rootStackName) {
        const knownStackNames = Object.keys(currentNestedCfnStackResources);
        if (input.StackName !== rootStackName && !knownStackNames.includes(input.StackName)) {
          throw new Error(
            `Expected Stack name in listStackResources() call to be a member of ['${rootStackName}, ${knownStackNames}'], but received: '${input.StackName}'`,
          );
        }
      } else if (input.StackName !== STACK_NAME) {
        throw new Error(
          `Expected Stack name in listStackResources() call to be: '${STACK_NAME}', but received: '${input.StackName}'`,
        );
      }
      return {
        StackResourceSummaries: rootStackName
          ? currentNestedCfnStackResources[input.StackName]
          : currentCfnStackResources,
      };
    });
  }

  public tryHotswapDeployment(
    hotswapMode: HotswapMode,
    stackArtifact: cxapi.CloudFormationStackArtifact,
    assetParams: { [key: string]: string } = {},
    hotswapPropertyOverrides?: HotswapPropertyOverrides,
  ): Promise<SuccessfulDeployStackResult | undefined> {
    let hotswapProps = hotswapPropertyOverrides || new HotswapPropertyOverrides();
    return tryHotswapDeployment(this, ioHost.asHelper('deploy'), assetParams, currentCfnStack, stackArtifact, hotswapMode as any, hotswapProps);
  }
}
