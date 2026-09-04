import { AssetManifest } from '@aws-cdk/cdk-assets-lib';
import {
  ContinueUpdateRollbackCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  ListStackResourcesCommand,
  RollbackStackCommand,
  type StackResourceSummary,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { CloudFormationStack } from '../../../lib/api/cloudformation';
import { Deployments } from '../../../lib/api/deployments';
import * as cfnApi from '../../../lib/api/deployments/cfn-api';
import { determineAllowCrossAccountAssetPublishing } from '../../../lib/api/deployments/checks';
import { deployStack, destroyStack } from '../../../lib/api/deployments/deploy-stack';
import { ToolkitInfo } from '../../../lib/api/toolkit-info';
import type { BootstrapError } from '../../../lib/toolkit/toolkit-error';
import { ToolkitError } from '../../../lib/toolkit/toolkit-error';
import { testStack } from '../../_helpers/assembly';
import {
  mockBootstrapStack,
  mockCloudFormationClient,
  MockSdk,
  MockSdkProvider,
  mockSSMClient,
  restoreSdkMocksToDefault,
  setDefaultSTSMocks,
} from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';
import { FakeCloudformationStack } from '../_helpers/fake-cloudformation-stack';

jest.mock('../../../lib/api/deployments/deploy-stack');
jest.mock('../../../lib/api/deployments/asset-publishing');
jest.mock('../../../lib/api/deployments/checks');

let sdkProvider: MockSdkProvider;
let sdk: MockSdk;
let deployments: Deployments;
let mockToolkitInfoLookup: jest.Mock;
let currentCfnStackResources: { [key: string]: StackResourceSummary[] };
let ioHost = new TestIoHost();
let ioHelper = ioHost.asHelper('deploy');

beforeEach(() => {
  jest.resetAllMocks();
  sdkProvider = new MockSdkProvider();
  sdk = new MockSdk();
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
  deployments = new Deployments({ sdkProvider, ioHelper });

  currentCfnStackResources = {};
  restoreSdkMocksToDefault();
  ToolkitInfo.lookup = mockToolkitInfoLookup = jest
    .fn()
    .mockResolvedValue(ToolkitInfo.bootstrapStackNotFoundInfo('TestBootstrapStack'));
  setDefaultSTSMocks();
});

function mockSuccessfulBootstrapStackLookup(props?: Record<string, any>) {
  const outputs = {
    BucketName: 'BUCKET_NAME',
    BucketDomainName: 'BUCKET_ENDPOINT',
    BootstrapVersion: '1',
    ...props,
  };

  const fakeStack = mockBootstrapStack({
    Outputs: Object.entries(outputs).map(([k, v]) => ({
      OutputKey: k,
      OutputValue: `${v}`,
    })),
  });

  mockToolkitInfoLookup.mockResolvedValue(ToolkitInfo.fromStack(fakeStack));
}

test('passes through deploymentMethod with hotswap to deployStack()', async () => {
  // WHEN
  await deployments.deployStack({
    stack: testStack({
      stackName: 'boop',
    }),
    deploymentMethod: { method: 'hotswap', fallback: { method: 'change-set' } },
  });

  // THEN
  expect(deployStack).toHaveBeenCalledWith(
    expect.objectContaining({
      deploymentMethod: { method: 'hotswap', fallback: { method: 'change-set' } },
    }),
    expect.anything(),
  );
});

test('prepareStack calls deployStack with execute: false and returns successful result', async () => {
  // GIVEN
  (deployStack as jest.Mock).mockResolvedValue({
    type: 'did-deploy-stack',
    noOp: false,
    deleteFailures: [],
    stabilizingResources: [],
    outputs: {},
    stackArn: 'arn:stack',
    changeSet: { Status: 'CREATE_COMPLETE' },
  });

  // WHEN
  const result = await deployments.prepareStack({
    stack: testStack({ stackName: 'boop' }),
    deploymentMethod: { method: 'change-set', changeSetName: 'my-cs' },
  });

  // THEN
  expect(deployStack).toHaveBeenCalledWith(
    expect.objectContaining({
      deploymentMethod: { method: 'change-set', changeSetName: 'my-cs', execute: false },
    }),
    expect.anything(),
  );
  expect(result).toEqual(expect.objectContaining({
    type: 'did-deploy-stack',
    noOp: false,
    deleteFailures: [],
    stabilizingResources: [],
    changeSet: { Status: 'CREATE_COMPLETE' },
  }));
});

test('prepareStack passes willExecuteChangeSet through to deployStack', async () => {
  // GIVEN
  (deployStack as jest.Mock).mockResolvedValue({
    type: 'did-deploy-stack',
    noOp: false,
    deleteFailures: [],
    stabilizingResources: [],
    outputs: {},
    stackArn: 'arn:stack',
    changeSet: { ChangeSetId: 'arn:change-set', Status: 'CREATE_COMPLETE' },
  });

  // WHEN — willExecuteChangeSet marks this prepare as the internal first
  // phase of a two-phase (create + execute) deployment
  await deployments.prepareStack({
    stack: testStack({ stackName: 'boop' }),
    deploymentMethod: { method: 'change-set' },
    willExecuteChangeSet: true,
  });

  // THEN — deployStack suppresses the "waiting in review for manual
  // execution (--no-execute)" announcement based on this flag
  expect(deployStack).toHaveBeenCalledWith(
    expect.objectContaining({
      willExecuteChangeSet: true,
    }),
    expect.anything(),
  );
});

test('prepareStack leaves willExecuteChangeSet unset for a user-requested --no-execute prepare', async () => {
  // GIVEN
  (deployStack as jest.Mock).mockResolvedValue({
    type: 'did-deploy-stack',
    noOp: false,
    deleteFailures: [],
    stabilizingResources: [],
    outputs: {},
    stackArn: 'arn:stack',
    changeSet: { ChangeSetId: 'arn:change-set', Status: 'CREATE_COMPLETE' },
  });

  // WHEN — no willExecuteChangeSet means the change set is the final result (--no-execute)
  await deployments.prepareStack({
    stack: testStack({ stackName: 'boop' }),
    deploymentMethod: { method: 'change-set', execute: false },
  });

  // THEN — deployStack announces the change set as awaiting manual execution
  expect((deployStack as jest.Mock).mock.calls[0][0].willExecuteChangeSet).toBeUndefined();
});

test('prepareStack returns undefined for non-success results', async () => {
  // GIVEN
  (deployStack as jest.Mock).mockResolvedValue({
    type: 'replacement-requires-rollback',
  });

  // WHEN
  const result = await deployments.prepareStack({
    stack: testStack({ stackName: 'boop' }),
    deploymentMethod: { method: 'change-set' },
  });

  // THEN
  expect(result).toBeUndefined();
});

test('prepareStack forwards stackEventPollingInterval to cleanupChangeSet as the stabilization interval', async () => {
  // GIVEN
  (deployStack as jest.Mock).mockResolvedValue({
    type: 'did-deploy-stack',
    noOp: true,
    deleteFailures: [],
    stabilizingResources: [],
    outputs: {},
    stackArn: 'arn:stack',
    changeSet: { ChangeSetName: 'my-cs', Status: 'CREATE_COMPLETE' },
  });
  givenStacks({
    boop: { template: {}, stackStatus: 'REVIEW_IN_PROGRESS' },
  });
  const waitForStackDeleteSpy = jest.spyOn(cfnApi, 'waitForStackDelete');

  // WHEN
  await deployments.prepareStack({
    stack: testStack({ stackName: 'boop' }),
    deploymentMethod: { method: 'change-set' },
    willExecuteChangeSet: true,
    stackEventPollingInterval: 10_000,
  });

  // THEN
  expect(waitForStackDeleteSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    'boop',
    10_000,
  );
});

test('passes through stackEventPollingInterval to deployStack()', async () => {
  // WHEN
  await deployments.deployStack({
    stack: testStack({
      stackName: 'boop',
    }),
    stackEventPollingInterval: 10_000,
  });

  // THEN
  expect(deployStack).toHaveBeenCalledWith(
    expect.objectContaining({
      stackEventPollingInterval: 10_000,
    }),
    expect.anything(),
  );
});

test('passes through stackEventPollingInterval to destroyStack()', async () => {
  // WHEN
  await deployments.destroyStack({
    stack: testStack({
      stackName: 'boop',
    }),
    stackEventPollingInterval: 10_000,
  });

  // THEN
  expect(destroyStack).toHaveBeenCalledWith(
    expect.objectContaining({
      stackEventPollingInterval: 10_000,
    }),
    expect.anything(),
  );
});

test('placeholders are substituted in CloudFormation execution role', async () => {
  await deployments.deployStack({
    stack: testStack({
      stackName: 'boop',
      properties: {
        cloudFormationExecutionRoleArn: 'bloop:${AWS::Region}:${AWS::AccountId}',
      },
    }),
  });

  expect(deployStack).toHaveBeenCalledWith(
    expect.objectContaining({
      roleArn: 'bloop:here:123456789012',
    }),
    expect.anything(),
  );
});

test('role with placeholders is assumed if assumerole is given', async () => {
  const mockForEnvironment = jest.fn().mockImplementation(() => {
    return { sdk: new MockSdk() };
  });
  sdkProvider.forEnvironment = mockForEnvironment;

  await deployments.deployStack({
    stack: testStack({
      stackName: 'boop',
      properties: {
        assumeRoleArn: 'bloop:${AWS::Region}:${AWS::AccountId}',
      },
    }),
  });

  expect(mockForEnvironment).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({
      assumeRoleArn: 'bloop:here:123456789012',
    }),
  );
});

test('deployment fails if bootstrap stack is missing', async () => {
  await expect(
    deployments.deployStack({
      stack: testStack({
        stackName: 'boop',
        properties: {
          assumeRoleArn: 'bloop:${AWS::Region}:${AWS::AccountId}',
          requiresBootstrapStackVersion: 99,
        },
      }),
    }),
  ).rejects.toThrow(/requires a bootstrap stack/);
});

test('deployment fails if bootstrap stack is too old', async () => {
  mockSuccessfulBootstrapStackLookup({
    BootstrapVersion: 5,
  });
  setDefaultSTSMocks();

  await expect(
    deployments.deployStack({
      stack: testStack({
        stackName: 'boop',
        properties: {
          assumeRoleArn: 'bloop:${AWS::Region}:${AWS::AccountId}',
          requiresBootstrapStackVersion: 99,
        },
      }),
    }),
  ).rejects.toThrow(/requires bootstrap stack version '99', found '5'/);
});

test('bootstrap version failure keeps the BootstrapError as cause', async () => {
  // GIVEN
  mockSuccessfulBootstrapStackLookup({
    BootstrapVersion: 5,
  });
  setDefaultSTSMocks();

  // WHEN
  const error = await deployments.deployStack({
    stack: testStack({
      stackName: 'boop',
      properties: {
        assumeRoleArn: 'bloop:${AWS::Region}:${AWS::AccountId}',
        requiresBootstrapStackVersion: 99,
      },
    }),
  }).then(() => undefined, (e) => e);

  // THEN - the stack name and the generic error code are preserved...
  expect(error.name).toBe('BootstrapVersionValidation');
  expect(error.message).toMatch(/^boop: /);

  // ...and the BootstrapError (with its environment) remains discoverable
  // by walking the cause chain
  expect(ToolkitError.isBootstrapError(error.cause)).toBe(true);
  expect((error.cause as BootstrapError).environment).toEqual({
    account: '123456789012',
    region: 'here',
  });
});

test.each([false, true])(
  'if toolkit stack be found: %p but SSM parameter name is present deployment succeeds',
  async (canLookup) => {
    if (canLookup) {
      mockSuccessfulBootstrapStackLookup({
        BootstrapVersion: 2,
      });
    }
    setDefaultSTSMocks();

    mockSSMClient.on(GetParameterCommand).resolves({
      Parameter: {
        Value: '99',
      },
    });

    await deployments.deployStack({
      stack: testStack({
        stackName: 'boop',
        properties: {
          assumeRoleArn: 'bloop:${AWS::Region}:${AWS::AccountId}',
          requiresBootstrapStackVersion: 99,
          bootstrapStackVersionSsmParameter: '/some/parameter',
        },
      }),
    });

    expect(mockSSMClient).toHaveReceivedCommandWith(GetParameterCommand, {
      Name: '/some/parameter',
    });
  },
);

test('readCurrentTemplateWithNestedStacks() can handle non-Resources in the template', async () => {
  const stackSummary = stackSummaryOf(
    'NestedStack',
    'AWS::CloudFormation::Stack',
    'arn:aws:cloudformation:bermuda-triangle-1337:123456789012:stack/NestedStack/abcd',
  );

  pushStackResourceSummaries('ParentOfStackWithOutputAndParameter', stackSummary);

  mockCloudFormationClient.on(ListStackResourcesCommand).resolvesOnce({
    StackResourceSummaries: [stackSummary],
  });
  mockCloudFormationClient.on(DescribeStacksCommand).resolvesOnce({
    Stacks: [
      {
        StackName: 'NestedStack',
        RootId: 'StackId',
        CreationTime: new Date(),
        StackStatus: StackStatus.CREATE_COMPLETE,
      },
    ],
  });

  const cfnStack = new FakeCloudformationStack({
    stackName: 'ParentOfStackWithOutputAndParameter',
    stackId: 'StackId',
  });
  CloudFormationStack.lookup = async (_, stackName: string) => {
    switch (stackName) {
      case 'ParentOfStackWithOutputAndParameter':
        cfnStack.template = async () => ({
          Resources: {
            NestedStack: {
              Type: 'AWS::CloudFormation::Stack',
              Properties: {
                TemplateURL: 'https://www.magic-url.com',
              },
              Metadata: {
                'aws:asset:path': 'one-output-one-param-stack.nested.template.json',
              },
            },
          },
        });
        break;

      case 'NestedStack':
        cfnStack.template = async () => ({
          Resources: {
            NestedResource: {
              Type: 'AWS::Something',
              Properties: {
                Property: 'old-value',
              },
            },
          },
          Parameters: {
            NestedParam: {
              Type: 'String',
            },
          },
          Outputs: {
            NestedOutput: {
              Value: {
                Ref: 'NestedResource',
              },
            },
          },
        });
        break;

      default:
        throw new Error('unknown stack name ' + stackName + ' found');
    }

    return cfnStack;
  };

  const rootStack = testStack({
    stackName: 'ParentOfStackWithOutputAndParameter',
    template: {
      Resources: {
        NestedStack: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.magic-url.com',
          },
          Metadata: {
            'aws:asset:path': 'one-output-one-param-stack.nested.template.json',
          },
        },
      },
    },
  });

  // WHEN
  const rootTemplate = await deployments.readCurrentTemplateWithNestedStacks(rootStack);
  const deployedTemplate = rootTemplate.deployedRootTemplate;
  const nestedStacks = rootTemplate.nestedStacks;

  // THEN
  expect(deployedTemplate).toEqual({
    Resources: {
      NestedStack: {
        Type: 'AWS::CloudFormation::Stack',
        Properties: {
          TemplateURL: 'https://www.magic-url.com',
        },
        Metadata: {
          'aws:asset:path': 'one-output-one-param-stack.nested.template.json',
        },
      },
    },
  });

  expect(rootStack.template).toEqual({
    Resources: {
      NestedStack: {
        Type: 'AWS::CloudFormation::Stack',
        Properties: {
          TemplateURL: 'https://www.magic-url.com',
        },
        Metadata: {
          'aws:asset:path': 'one-output-one-param-stack.nested.template.json',
        },
      },
    },
  });

  expect(nestedStacks).toEqual({
    NestedStack: {
      deployedTemplate: {
        Outputs: {
          NestedOutput: {
            Value: {
              Ref: 'NestedResource',
            },
          },
        },
        Parameters: {
          NestedParam: {
            Type: 'String',
          },
        },
        Resources: {
          NestedResource: {
            Properties: {
              Property: 'old-value',
            },
            Type: 'AWS::Something',
          },
        },
      },
      generatedTemplate: {
        Outputs: {
          NestedOutput: {
            Value: {
              Ref: 'NestedResource',
            },
          },
        },
        Parameters: {
          NestedParam: {
            Type: 'Number',
          },
        },
        Resources: {
          NestedResource: {
            Properties: {
              Property: 'new-value',
            },
            Type: 'AWS::Something',
          },
        },
      },
      nestedStackTemplates: {},
      physicalName: 'NestedStack',
    },
  });
});

test('readCurrentTemplateWithNestedStacks() with a 3-level nested + sibling structure works', async () => {
  const rootSummary = stackSummaryOf(
    'NestedStack',
    'AWS::CloudFormation::Stack',
    'arn:aws:cloudformation:bermuda-triangle-1337:123456789012:stack/NestedStack/abcd',
  );

  const nestedStackSummary = [
    stackSummaryOf(
      'GrandChildStackA',
      'AWS::CloudFormation::Stack',
      'arn:aws:cloudformation:bermuda-triangle-1337:123456789012:stack/GrandChildStackA/abcd',
    ),
    stackSummaryOf(
      'GrandChildStackB',
      'AWS::CloudFormation::Stack',
      'arn:aws:cloudformation:bermuda-triangle-1337:123456789012:stack/GrandChildStackB/abcd',
    ),
  ];

  const grandChildAStackSummary = stackSummaryOf(
    'GrandChildA',
    'AWS::CloudFormation::Stack',
    'arn:aws:cloudformation:bermuda-triangle-1337:123456789012:stack/GrandChildA/abcd',
  );

  const grandchildBStackSummary = stackSummaryOf(
    'GrandChildB',
    'AWS::CloudFormation::Stack',
    'arn:aws:cloudformation:bermuda-triangle-1337:123456789012:stack/GrandChildB/abcd',
  );

  pushStackResourceSummaries('MultiLevelRoot', rootSummary);
  pushStackResourceSummaries('NestedStack', ...nestedStackSummary);
  pushStackResourceSummaries('GrandChildStackA', grandChildAStackSummary);
  pushStackResourceSummaries('GrandChildStackB', grandchildBStackSummary);

  mockCloudFormationClient
    .on(ListStackResourcesCommand)
    .resolvesOnce({
      StackResourceSummaries: [rootSummary],
    })
    .resolvesOnce({
      StackResourceSummaries: nestedStackSummary,
    })
    .resolvesOnce({
      StackResourceSummaries: [grandChildAStackSummary],
    })
    .resolvesOnce({
      StackResourceSummaries: [grandchildBStackSummary],
    });

  mockCloudFormationClient
    .on(DescribeStacksCommand)
    .resolvesOnce({
      Stacks: [
        {
          StackName: 'NestedStack',
          RootId: 'StackId',
          CreationTime: new Date(),
          StackStatus: StackStatus.CREATE_COMPLETE,
        },
      ],
    })
    .resolvesOnce({
      Stacks: [
        {
          StackName: 'GrandChildStackA',
          RootId: 'StackId',
          ParentId: 'NestedStack',
          CreationTime: new Date(),
          StackStatus: StackStatus.CREATE_COMPLETE,
        },
      ],
    })
    .resolvesOnce({
      Stacks: [
        {
          StackName: 'GrandChildStackB',
          RootId: 'StackId',
          ParentId: 'NestedStack',
          CreationTime: new Date(),
          StackStatus: StackStatus.CREATE_COMPLETE,
        },
      ],
    });
  givenStacks({
    MultiLevelRoot: {
      template: {
        Resources: {
          NestedStack: {
            Type: 'AWS::CloudFormation::Stack',
            Properties: {
              TemplateURL: 'https://www.magic-url.com',
            },
            Metadata: {
              'aws:asset:path': 'one-resource-two-stacks-stack.nested.template.json',
            },
          },
        },
      },
    },
    NestedStack: {
      template: {
        Resources: {
          SomeResource: {
            Type: 'AWS::Something',
            Properties: {
              Property: 'old-value',
            },
          },
          GrandChildStackA: {
            Type: 'AWS::CloudFormation::Stack',
            Properties: {
              TemplateURL: 'https://www.magic-url.com',
            },
            Metadata: {
              'aws:asset:path': 'one-resource-stack.nested.template.json',
            },
          },
          GrandChildStackB: {
            Type: 'AWS::CloudFormation::Stack',
            Properties: {
              TemplateURL: 'https://www.magic-url.com',
            },
            Metadata: {
              'aws:asset:path': 'one-resource-stack.nested.template.json',
            },
          },
        },
      },
    },
    GrandChildStackA: {
      template: {
        Resources: {
          SomeResource: {
            Type: 'AWS::Something',
            Properties: {
              Property: 'old-value',
            },
          },
        },
      },
    },
    GrandChildStackB: {
      template: {
        Resources: {
          SomeResource: {
            Type: 'AWS::Something',
            Properties: {
              Property: 'old-value',
            },
          },
        },
      },
    },
  });

  const rootStack = testStack({
    stackName: 'MultiLevelRoot',
    template: {
      Resources: {
        NestedStack: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.magic-url.com',
          },
          Metadata: {
            'aws:asset:path': 'one-resource-two-stacks-stack.nested.template.json',
          },
        },
      },
    },
  });

  // WHEN
  const rootTemplate = await deployments.readCurrentTemplateWithNestedStacks(rootStack);
  const deployedTemplate = rootTemplate.deployedRootTemplate;
  const nestedStacks = rootTemplate.nestedStacks;

  // THEN
  expect(deployedTemplate).toEqual({
    Resources: {
      NestedStack: {
        Type: 'AWS::CloudFormation::Stack',
        Properties: {
          TemplateURL: 'https://www.magic-url.com',
        },
        Metadata: {
          'aws:asset:path': 'one-resource-two-stacks-stack.nested.template.json',
        },
      },
    },
  });

  expect(rootStack.template).toEqual({
    Resources: {
      NestedStack: {
        Type: 'AWS::CloudFormation::Stack',
        Properties: {
          TemplateURL: 'https://www.magic-url.com',
        },
        Metadata: {
          'aws:asset:path': 'one-resource-two-stacks-stack.nested.template.json',
        },
      },
    },
  });

  expect(nestedStacks).toEqual({
    NestedStack: {
      deployedTemplate: {
        Resources: {
          GrandChildStackA: {
            Metadata: {
              'aws:asset:path': 'one-resource-stack.nested.template.json',
            },
            Properties: {
              TemplateURL: 'https://www.magic-url.com',
            },
            Type: 'AWS::CloudFormation::Stack',
          },
          GrandChildStackB: {
            Metadata: {
              'aws:asset:path': 'one-resource-stack.nested.template.json',
            },
            Properties: {
              TemplateURL: 'https://www.magic-url.com',
            },
            Type: 'AWS::CloudFormation::Stack',
          },
          SomeResource: {
            Properties: {
              Property: 'old-value',
            },
            Type: 'AWS::Something',
          },
        },
      },
      generatedTemplate: {
        Resources: {
          GrandChildStackA: {
            Metadata: {
              'aws:asset:path': 'one-resource-stack.nested.template.json',
            },
            Properties: {
              TemplateURL: 'https://www.magic-url.com',
            },
            Type: 'AWS::CloudFormation::Stack',
          },
          GrandChildStackB: {
            Metadata: {
              'aws:asset:path': 'one-resource-stack.nested.template.json',
            },
            Properties: {
              TemplateURL: 'https://www.magic-url.com',
            },
            Type: 'AWS::CloudFormation::Stack',
          },
          SomeResource: {
            Properties: {
              Property: 'new-value',
            },
            Type: 'AWS::Something',
          },
        },
      },
      nestedStackTemplates: {
        GrandChildStackA: {
          deployedTemplate: {
            Resources: {
              SomeResource: {
                Properties: {
                  Property: 'old-value',
                },
                Type: 'AWS::Something',
              },
            },
          },
          generatedTemplate: {
            Resources: {
              SomeResource: {
                Properties: {
                  Property: 'new-value',
                },
                Type: 'AWS::Something',
              },
            },
          },
          nestedStackTemplates: {},
          physicalName: 'GrandChildStackA',
        },
        GrandChildStackB: {
          deployedTemplate: {
            Resources: {
              SomeResource: {
                Properties: {
                  Property: 'old-value',
                },
                Type: 'AWS::Something',
              },
            },
          },
          generatedTemplate: {
            Resources: {
              SomeResource: {
                Properties: {
                  Property: 'new-value',
                },
                Type: 'AWS::Something',
              },
            },
          },
          nestedStackTemplates: {},
          physicalName: 'GrandChildStackB',
        },
      },
      physicalName: 'NestedStack',
    },
  });
});

test('readCurrentTemplateWithNestedStacks() on an undeployed parent stack with an (also undeployed) nested stack works', async () => {
  // GIVEN
  const cfnStack = new FakeCloudformationStack({
    stackName: 'UndeployedParent',
    stackId: 'StackId',
  });
  CloudFormationStack.lookup = async (_cfn, _stackName: string) => {
    cfnStack.template = async () => ({});

    return cfnStack;
  };
  const rootStack = testStack({
    stackName: 'UndeployedParent',
    template: {
      Resources: {
        NestedStack: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.magic-url.com',
          },
          Metadata: {
            'aws:asset:path': 'one-resource-one-stack-stack.nested.template.json',
          },
        },
      },
    },
  });

  // WHEN
  const deployedTemplate = (await deployments.readCurrentTemplateWithNestedStacks(rootStack)).deployedRootTemplate;
  const nestedStacks = (await deployments.readCurrentTemplateWithNestedStacks(rootStack)).nestedStacks;

  // THEN
  expect(deployedTemplate).toEqual({});
  expect(nestedStacks).toEqual({
    NestedStack: {
      deployedTemplate: {},
      generatedTemplate: {
        Resources: {
          SomeResource: {
            Type: 'AWS::Something',
            Properties: {
              Property: 'new-value',
            },
          },
          NestedStack: {
            Type: 'AWS::CloudFormation::Stack',
            Properties: {
              TemplateURL: 'https://www.magic-url.com',
            },
            Metadata: {
              'aws:asset:path': 'one-resource-stack.nested.template.json',
            },
          },
        },
      },
      nestedStackTemplates: {
        NestedStack: {
          deployedTemplate: {},
          generatedTemplate: {
            Resources: {
              SomeResource: {
                Type: 'AWS::Something',
                Properties: {
                  Property: 'new-value',
                },
              },
            },
          },
          nestedStackTemplates: {},
        },
      },
    },
  });
});

test('readCurrentTemplateWithNestedStacks() caches calls to listStackResources()', async () => {
  // GIVEN
  givenStacks({
    '*': {
      template: {
        Resources: {
          NestedStackA: {
            Type: 'AWS::CloudFormation::Stack',
            Properties: {
              TemplateURL: 'https://www.magic-url.com',
            },
            Metadata: {
              'aws:asset:path': 'one-resource-stack.nested.template.json',
            },
          },
          NestedStackB: {
            Type: 'AWS::CloudFormation::Stack',
            Properties: {
              TemplateURL: 'https://www.magic-url.com',
            },
            Metadata: {
              'aws:asset:path': 'one-resource-stack.nested.template.json',
            },
          },
        },
      },
    },
  });

  const rootStack = testStack({
    stackName: 'CachingRoot',
    template: {
      Resources: {
        NestedStackA: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.magic-url.com',
          },
          Metadata: {
            'aws:asset:path': 'one-resource-stack.nested.template.json',
          },
        },
        NestedStackB: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.magic-url.com',
          },
          Metadata: {
            'aws:asset:path': 'one-resource-stack.nested.template.json',
          },
        },
      },
    },
  });

  pushStackResourceSummaries(
    'CachingRoot',
    stackSummaryOf(
      'NestedStackA',
      'AWS::CloudFormation::Stack',
      'arn:aws:cloudformation:bermuda-triangle-1337:123456789012:stack/one-resource-stack/abcd',
    ),
    stackSummaryOf(
      'NestedStackB',
      'AWS::CloudFormation::Stack',
      'arn:aws:cloudformation:bermuda-triangle-1337:123456789012:stack/one-resource-stack/abcd',
    ),
  );

  // WHEN
  await deployments.readCurrentTemplateWithNestedStacks(rootStack);

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandTimes(ListStackResourcesCommand, 1);
});

test('rollback stack assumes role if necessary', async () => {
  const mockForEnvironment = jest.fn().mockImplementation(() => {
    return { sdk };
  });
  sdkProvider.forEnvironment = mockForEnvironment;
  givenStacks({
    '*': { template: {} },
  });

  await deployments.rollbackStack({
    stack: testStack({
      stackName: 'boop',
      properties: {
        assumeRoleArn: 'bloop:${AWS::Region}:${AWS::AccountId}',
      },
    }),
    validateBootstrapStackVersion: false,
  });

  expect(mockForEnvironment).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({
      assumeRoleArn: 'bloop:here:123456789012',
    }),
  );
});

test('rollback stack allows rolling back from UPDATE_FAILED', async () => {
  // GIVEN
  givenStacks({
    '*': { template: {}, stackStatus: 'UPDATE_FAILED' },
  });

  // WHEN
  await deployments.rollbackStack({
    stack: testStack({ stackName: 'boop' }),
    validateBootstrapStackVersion: false,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(RollbackStackCommand);
});

test('rollback stack is not failed by a throttled stack event poll', async () => {
  // GIVEN - reading stack events fails throughout, including the final poll in monitor.stop()
  givenStacks({
    '*': { template: {}, stackStatus: 'UPDATE_FAILED' },
  });
  mockCloudFormationClient.on(DescribeStackEventsCommand).rejects(
    Object.assign(new Error('Rate exceeded'), { name: 'Throttling' }),
  );

  // WHEN
  const response = await deployments.rollbackStack({
    stack: testStack({ stackName: 'boop' }),
    validateBootstrapStackVersion: false,
  });

  // THEN - the rollback succeeded, and the final poll failure was only reported
  expect(response).toMatchObject({ success: true });
  ioHost.expectMessage({ level: 'warn', containing: 'Error occurred during final stack event poll' });
});

test('rollback stack allows continue rollback from UPDATE_ROLLBACK_FAILED', async () => {
  // GIVEN
  givenStacks({
    '*': { template: {}, stackStatus: 'UPDATE_ROLLBACK_FAILED' },
  });

  // WHEN
  await deployments.rollbackStack({
    stack: testStack({ stackName: 'boop' }),
    validateBootstrapStackVersion: false,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(ContinueUpdateRollbackCommand);
});

test('rollback stack fails in UPDATE_COMPLETE state', async () => {
  // GIVEN
  givenStacks({
    '*': { template: {}, stackStatus: 'UPDATE_COMPLETE' },
  });

  // WHEN
  const response = await deployments.rollbackStack({
    stack: testStack({ stackName: 'boop' }),
    validateBootstrapStackVersion: false,
  });

  // THEN
  expect(response.notInRollbackableState).toBe(true);
});

test('continue rollback stack with orphanFailedResources ignores any failed resources', async () => {
  // GIVEN
  givenStacks({
    '*': { template: {}, stackStatus: 'UPDATE_ROLLBACK_FAILED' },
  });
  mockCloudFormationClient.on(DescribeStackEventsCommand).resolves({
    StackEvents: [
      {
        EventId: 'asdf',
        StackId: 'stack/MyStack',
        StackName: 'MyStack',
        Timestamp: new Date(),
        LogicalResourceId: 'Xyz',
        ResourceStatus: 'UPDATE_FAILED',
      },
    ],
  });

  // WHEN
  await deployments.rollbackStack({
    stack: testStack({ stackName: 'boop' }),
    validateBootstrapStackVersion: false,
    orphanFailedResources: true,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(ContinueUpdateRollbackCommand, {
    ResourcesToSkip: ['Xyz'],
    StackName: 'stack/boop',
    ClientRequestToken: expect.anything(),
  });
});

test('readCurrentTemplateWithNestedStacks() successfully ignores stacks without metadata', async () => {
  // GIVEN
  const rootSummary = stackSummaryOf(
    'WithMetadata',
    'AWS::CloudFormation::Stack',
    'arn:aws:cloudformation:bermuda-triangle-1337:123456789012:stack/one-resource-stack/abcd',
  );

  pushStackResourceSummaries('MetadataRoot', rootSummary);
  mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
    StackResourceSummaries: [rootSummary],
  });

  givenStacks({
    'MetadataRoot': {
      template: {
        Resources: {
          WithMetadata: {
            Type: 'AWS::CloudFormation::Stack',
            Properties: {
              TemplateURL: 'https://www.magic-url.com',
            },
            Metadata: {
              'aws:asset:path': 'one-resource-stack.nested.template.json',
            },
          },
        },
      },
    },
    '*': {
      template: {
        Resources: {
          SomeResource: {
            Type: 'AWS::Something',
            Properties: {
              Property: 'old-value',
            },
          },
        },
      },
    },
  });

  const rootStack = testStack({
    stackName: 'MetadataRoot',
    template: {
      Resources: {
        WithoutMetadata: {
          Properties: {
            TemplateURL: 'https://www.magic-url.com',
          },
          Type: 'AWS::CloudFormation::Stack',
        },
        WithEmptyMetadata: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.magic-url.com',
          },
          Metadata: {},
        },
        WithMetadata: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: {
            TemplateURL: 'https://www.magic-url.com',
          },
          Metadata: {
            'aws:asset:path': 'one-resource-stack.nested.template.json',
          },
        },
      },
    },
  });

  // WHEN
  const deployedTemplate = (await deployments.readCurrentTemplateWithNestedStacks(rootStack)).deployedRootTemplate;
  const nestedStacks = (await deployments.readCurrentTemplateWithNestedStacks(rootStack)).nestedStacks;

  // THEN
  expect(deployedTemplate).toEqual({
    Resources: {
      WithMetadata: {
        Type: 'AWS::CloudFormation::Stack',
        Properties: {
          TemplateURL: 'https://www.magic-url.com',
        },
        Metadata: {
          'aws:asset:path': 'one-resource-stack.nested.template.json',
        },
      },
    },
  });

  expect(rootStack.template).toEqual({
    Resources: {
      WithoutMetadata: {
        // Unchanged
        Type: 'AWS::CloudFormation::Stack',
        Properties: {
          TemplateURL: 'https://www.magic-url.com',
        },
      },
      WithEmptyMetadata: {
        // Unchanged
        Type: 'AWS::CloudFormation::Stack',
        Properties: {
          TemplateURL: 'https://www.magic-url.com',
        },
        Metadata: {},
      },
      WithMetadata: {
        // Changed
        Type: 'AWS::CloudFormation::Stack',
        Properties: {
          TemplateURL: 'https://www.magic-url.com',
        },
        Metadata: {
          'aws:asset:path': 'one-resource-stack.nested.template.json',
        },
      },
    },
  });

  expect(nestedStacks).toEqual({
    WithMetadata: {
      deployedTemplate: {
        Resources: {
          SomeResource: {
            Properties: {
              Property: 'old-value',
            },
            Type: 'AWS::Something',
          },
        },
      },
      generatedTemplate: {
        Resources: {
          SomeResource: {
            Properties: {
              Property: 'new-value',
            },
            Type: 'AWS::Something',
          },
        },
      },
      physicalName: 'one-resource-stack',
      nestedStackTemplates: {},
    },
  });
});

describe('stackExists', () => {
  test.each([
    [false, 'deploy:here:123456789012'],
    [true, 'lookup:here:123456789012'],
  ])('uses lookup role if requested: %p', async (tryLookupRole, expectedRoleArn) => {
    const mockForEnvironment = jest.fn().mockImplementation(() => {
      return { sdk: new MockSdk() };
    });
    sdkProvider.forEnvironment = mockForEnvironment;
    givenStacks({
      '*': { template: {} },
    });

    const result = await deployments.stackExists({
      stack: testStack({
        stackName: 'boop',
        properties: {
          assumeRoleArn: 'deploy:${AWS::Region}:${AWS::AccountId}',
          lookupRole: {
            arn: 'lookup:${AWS::Region}:${AWS::AccountId}',
          },
        },
      }),
      tryLookupRole,
    });

    expect(result).toBeTruthy();
    expect(mockForEnvironment).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      assumeRoleArn: expectedRoleArn,
    }));
  });
});

describe('cachedPublisher', () => {
  // Regression test: the publisher cache used to be keyed only by the AssetManifest
  // object, so if the same AssetManifest instance were ever passed in for two different
  // environments (e.g. a long-lived Deployments instance reused to deploy the same
  // synthesized cloud assembly to two different AWS accounts), the second call would
  // silently reuse the first publisher - built with the first account's credentials -
  // to build/publish/check assets against what should be an entirely different account.
  test('does not reuse a publisher across different environments for the same AssetManifest', () => {
    const manifest = new AssetManifest('/tmp/assets', { version: '1.0.0', files: {}, dockerImages: {} } as any);
    const envA = { name: 'aws://111111111111/us-east-1', account: '111111111111', region: 'us-east-1' };
    const envB = { name: 'aws://222222222222/eu-west-1', account: '222222222222', region: 'eu-west-1' };

    const publisherA = (deployments as any).cachedPublisher(manifest, envA, 'StackA');
    const publisherB = (deployments as any).cachedPublisher(manifest, envB, 'StackB');

    expect(publisherA).not.toBe(publisherB);
  });

  test('reuses the cached publisher for repeat calls with the same environment', () => {
    const manifest = new AssetManifest('/tmp/assets', { version: '1.0.0', files: {}, dockerImages: {} } as any);
    const env = { name: 'aws://111111111111/us-east-1', account: '111111111111', region: 'us-east-1' };

    const first = (deployments as any).cachedPublisher(manifest, env, 'StackA');
    const second = (deployments as any).cachedPublisher(manifest, env, 'StackA');

    expect(second).toBe(first);
  });
});

describe('allowCrossAccountAssetPublishingForEnv', () => {
  // Regression test: the cross-account-asset-publishing answer used to be cached in a
  // single un-keyed instance field, so the first stack's environment's answer was
  // silently reused for every other stack's environment on the same Deployments
  // instance (which is reused for every stack in one `cdk deploy` invocation).
  test('does not reuse the answer across different environments', async () => {
    sdkProvider.forEnvironment = jest.fn().mockImplementation(() => ({ sdk: new MockSdk() }));
    const mockDetermine = determineAllowCrossAccountAssetPublishing as jest.Mock;
    mockDetermine.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const stackA = testStack({ stackName: 'StackA', env: 'aws://111111111111/us-east-1' });
    const stackB = testStack({ stackName: 'StackB', env: 'aws://222222222222/eu-west-1' });

    const allowedForA = await (deployments as any).allowCrossAccountAssetPublishingForEnv(stackA);
    const allowedForB = await (deployments as any).allowCrossAccountAssetPublishingForEnv(stackB);

    expect(allowedForA).toBe(false);
    expect(allowedForB).toBe(true);
    expect(mockDetermine).toHaveBeenCalledTimes(2);
  });

  test('reuses the cached answer for repeat calls with the same environment', async () => {
    sdkProvider.forEnvironment = jest.fn().mockImplementation(() => ({ sdk: new MockSdk() }));
    const mockDetermine = determineAllowCrossAccountAssetPublishing as jest.Mock;
    mockDetermine.mockResolvedValueOnce(true);

    const stackA = testStack({ stackName: 'StackA', env: 'aws://111111111111/us-east-1' });
    const stackAAgain = testStack({ stackName: 'StackA', env: 'aws://111111111111/us-east-1' });

    const first = await (deployments as any).allowCrossAccountAssetPublishingForEnv(stackA);
    const second = await (deployments as any).allowCrossAccountAssetPublishingForEnv(stackAAgain);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(mockDetermine).toHaveBeenCalledTimes(1);
  });
});

function pushStackResourceSummaries(stackName: string, ...items: StackResourceSummary[]) {
  if (!currentCfnStackResources[stackName]) {
    currentCfnStackResources[stackName] = [];
  }

  currentCfnStackResources[stackName].push(...items);
}

function stackSummaryOf(logicalId: string, resourceType: string, physicalResourceId: string): StackResourceSummary {
  return {
    LogicalResourceId: logicalId,
    PhysicalResourceId: physicalResourceId,
    ResourceType: resourceType,
    ResourceStatus: StackStatus.CREATE_COMPLETE,
    LastUpdatedTimestamp: new Date(),
  };
}

function givenStacks(stacks: Record<string, { template: any; stackStatus?: string }>) {
  jest.spyOn(CloudFormationStack, 'lookup').mockImplementation(async (_, stackName) => {
    let stack = stacks[stackName];
    if (!stack) {
      stack = stacks['*'];
    }
    if (stack) {
      const cfnStack = new FakeCloudformationStack({
        stackName,
        stackId: `stack/${stackName}`,
        stackStatus: stack.stackStatus,
      });
      cfnStack.setTemplate(stack.template);
      return cfnStack;
    } else {
      return new FakeCloudformationStack({ stackName });
    }
  });
}
