import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CreateStackRefactorCommand,
  DescribeStackRefactorCommand,
  DescribeStacksCommand,
  ExecuteStackRefactorCommand,
  GetTemplateCommand,
  ListStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Deployments } from '../../lib/api';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import type { TestStackArtifact } from '../_helpers';
import { MockCloudExecutable } from '../_helpers';
import { IoHostRecorder } from '../_helpers/io-recorder';
import {
  mockCloudFormationClient,
  mockS3Client,
  restoreSdkMocksToDefault,
  setDefaultSTSMocks,
} from '../_helpers/mock-sdk';

// `cdk refactor` emits its entire plan (the mapping table, ambiguities,
// confirmation and progress) to the user. These tests capture the *whole*
// ordered stream of messages the command sends to the CliIoHost as an NDJSON
// snapshot, so a change to the user-facing output of any refactor variant shows
// up as a diff in review (see test/_helpers/io-recorder.ts).

const ACCOUNT = '123456789012';
const REGION = 'bermuda-triangle-1';
const ENV = `aws://${ACCOUNT}/${REGION}`;

/**
 * A bucket as the CDK framework would synthesize it, at the given construct path.
 */
function bucket(cdkPath: string) {
  return {
    Type: 'AWS::S3::Bucket',
    UpdateReplacePolicy: 'Retain',
    DeletionPolicy: 'Retain',
    Metadata: { 'aws:cdk:path': cdkPath },
  };
}

function queue(cdkPath: string) {
  return {
    Type: 'AWS::SQS::Queue',
    UpdateReplacePolicy: 'Delete',
    DeletionPolicy: 'Delete',
    Metadata: { 'aws:cdk:path': cdkPath },
  };
}

/**
 * A template big enough (> 50KiB) that the refactor has to upload it to S3
 * instead of sending it inline.
 */
function largeTemplate() {
  const resources: Record<string, any> = {};
  for (let i = 0; i < 500; i++) {
    resources[`Bucket${i}`] = {
      ...bucket(`Stack1/Bucket${i}/Resource`),
      Properties: {
        BucketName: `my-bucket-${i}`,
        Tags: [
          { Key: 'Environment', Value: 'Production' },
          { Key: 'Application', Value: 'MyApp' },
          { Key: 'Owner', Value: 'TeamA' },
          { Key: 'CostCenter', Value: '12345' },
        ],
      },
    };
  }
  return { Resources: resources };
}

/**
 * A large local template in which `Bucket0` has been renamed, so there is
 * exactly one mapping to compute.
 */
function largeTemplateWithRename() {
  const template = largeTemplate();
  template.Resources.RenamedBucket = {
    ...template.Resources.Bucket0,
    Metadata: { 'aws:cdk:path': 'Stack1/RenamedBucket/Resource' },
  };
  delete template.Resources.Bucket0;
  return template;
}

/**
 * Pretend the given stacks are deployed in the target environment, with the
 * given templates.
 */
function givenDeployedStacks(templates: Record<string, any>) {
  mockCloudFormationClient.on(ListStacksCommand).resolves({
    StackSummaries: Object.keys(templates).map((stackName) => ({
      StackName: stackName,
      StackId: `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${stackName}/abcd`,
      StackStatus: 'CREATE_COMPLETE',
      CreationTime: new Date(),
    })),
  });

  for (const [stackName, template] of Object.entries(templates)) {
    mockCloudFormationClient
      .on(GetTemplateCommand, { StackName: stackName })
      .resolves({ TemplateBody: JSON.stringify(template) });
  }
}

/**
 * Pretend the environment is bootstrapped under the given toolkit stack name.
 *
 * Only a lookup for exactly that name resolves; any other name (e.g. the
 * default `CDKToolkit`) falls through to the "no stacks" default and is
 * reported as "not bootstrapped". That is what makes the custom-toolkit-stack
 * tests below meaningful.
 */
function givenBootstrapStack(toolkitStackName: string, version = '28') {
  mockCloudFormationClient.on(DescribeStacksCommand, { StackName: toolkitStackName }).resolves({
    Stacks: [
      {
        StackName: toolkitStackName,
        CreationTime: new Date(),
        StackStatus: 'CREATE_COMPLETE',
        Outputs: [
          { OutputKey: 'BucketName', OutputValue: `${toolkitStackName}-bucket` },
          { OutputKey: 'BucketDomainName', OutputValue: `${toolkitStackName}-bucket.s3.amazonaws.com` },
          { OutputKey: 'BootstrapVersion', OutputValue: version },
        ],
      },
    ],
  });
}

let ioHost = CliIoHost.instance();
let recorder: IoHostRecorder;
let originalIsTTY: boolean;

async function makeToolkit(stacks: TestStackArtifact[], toolkitStackName?: string) {
  const cloudExecutable = await MockCloudExecutable.create({ stacks }, undefined, ioHost, 'refactor');
  return new CdkToolkit({
    ioHost,
    cloudExecutable,
    configuration: cloudExecutable.configuration,
    sdkProvider: cloudExecutable.sdkProvider,
    deployments: new Deployments({
      sdkProvider: cloudExecutable.sdkProvider,
      ioHelper: ioHost.asIoHelper(),
      toolkitStackName,
    }),
    toolkitStackName,
  });
}

beforeAll(() => {
  originalIsTTY = process.stdout.isTTY;
});

afterAll(() => {
  process.stdout.isTTY = originalIsTTY;
});

beforeEach(() => {
  jest.restoreAllMocks();
  restoreSdkMocksToDefault();
  setDefaultSTSMocks();

  ioHost = CliIoHost.instance();
  ioHost.isCI = false;
  ioHost.currentAction = 'refactor';

  // Non-interactive: the refactor only asks for confirmation on a TTY.
  process.stdout.isTTY = false;

  // The refactor finishes by deploying the updated stacks. Keep that off the
  // wire; the deploy stream itself is covered by the deploy tests.
  jest.spyOn(Deployments.prototype, 'readCurrentTemplate').mockResolvedValue({});
  jest.spyOn(Deployments.prototype, 'isSingleAssetPublished').mockResolvedValue(false);
  jest.spyOn(Deployments.prototype, 'deployStack').mockImplementation(async (options: any) => ({
    type: 'did-deploy-stack',
    stackArn: `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${options.stack.stackName}/abcd`,
    noOp: false,
    outputs: {},
    deleteFailures: [],
    stabilizingResources: [],
  }) as any);

  recorder = IoHostRecorder.create(ioHost);
});

afterEach(() => {
  // Snapshot every message this refactor variant sent to the CliIoHost.
  recorder.matchSnapshot();
});

describe('nothing to do', () => {
  test('reports that there is nothing to refactor when local and deployed templates match', async () => {
    givenDeployedStacks({ Stack1: { Resources: { MyBucket: bucket('Stack1/MyBucket/Resource') } } });

    const toolkit = await makeToolkit([{
      stackName: 'Stack1',
      env: ENV,
      template: { Resources: { MyBucket: bucket('Stack1/MyBucket/Resource') } },
    }]);

    await toolkit.refactor({ dryRun: true });

    expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateStackRefactorCommand);
  });
});

describe('--dry-run', () => {
  test('detects a renamed resource without creating a refactor', async () => {
    givenDeployedStacks({ Stack1: { Resources: { OldBucket: bucket('Stack1/OldBucket/Resource') } } });

    const toolkit = await makeToolkit([{
      stackName: 'Stack1',
      env: ENV,
      template: { Resources: { NewBucket: bucket('Stack1/NewBucket/Resource') } },
    }]);

    await toolkit.refactor({ dryRun: true });

    expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateStackRefactorCommand);
  });

  test('detects a resource moved to another stack', async () => {
    givenDeployedStacks({
      Stack1: { Resources: { MyBucket: bucket('Stack1/MyBucket/Resource') } },
      Stack2: { Resources: { MyQueue: queue('Stack2/MyQueue/Resource') } },
    });

    const toolkit = await makeToolkit([
      {
        stackName: 'Stack1',
        env: ENV,
        template: { Resources: {} },
      },
      {
        stackName: 'Stack2',
        env: ENV,
        template: {
          Resources: {
            MyQueue: queue('Stack2/MyQueue/Resource'),
            MyBucket: bucket('Stack2/MyBucket/Resource'),
          },
        },
      },
    ]);

    await toolkit.refactor({ dryRun: true });

    expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateStackRefactorCommand);
  });
});

describe('ambiguity', () => {
  test('reports ambiguous mappings and refuses to refactor', async () => {
    givenDeployedStacks({
      Stack1: {
        Resources: {
          Bucket1: bucket('Stack1/Bucket1/Resource'),
          Bucket2: bucket('Stack1/Bucket2/Resource'),
        },
      },
    });

    const toolkit = await makeToolkit([{
      stackName: 'Stack1',
      env: ENV,
      template: {
        Resources: {
          Bucket3: bucket('Stack1/Bucket3/Resource'),
          Bucket4: bucket('Stack1/Bucket4/Resource'),
        },
      },
    }]);

    await toolkit.refactor({ dryRun: false });

    expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateStackRefactorCommand);
  });

  test('an override file resolves the ambiguity', async () => {
    givenDeployedStacks({
      Stack1: {
        Resources: {
          Bucket1: bucket('Stack1/Bucket1/Resource'),
          Bucket2: bucket('Stack1/Bucket2/Resource'),
        },
      },
    });

    const toolkit = await makeToolkit([{
      stackName: 'Stack1',
      env: ENV,
      template: {
        Resources: {
          Bucket3: bucket('Stack1/Bucket3/Resource'),
          Bucket4: bucket('Stack1/Bucket4/Resource'),
        },
      },
    }]);

    const overrideFile = writeOverrideFile({
      environments: [{
        account: ACCOUNT,
        region: REGION,
        resources: {
          'Stack1.Bucket1': 'Stack1.Bucket3',
          'Stack1.Bucket2': 'Stack1.Bucket4',
        },
      }],
    });

    await toolkit.refactor({ dryRun: true, overrideFile });
  });

  test('--revert swaps the direction of the override file', async () => {
    givenDeployedStacks({
      Stack1: {
        Resources: {
          Bucket3: bucket('Stack1/Bucket3/Resource'),
          Bucket4: bucket('Stack1/Bucket4/Resource'),
        },
      },
    });

    const toolkit = await makeToolkit([{
      stackName: 'Stack1',
      env: ENV,
      template: {
        Resources: {
          Bucket1: bucket('Stack1/Bucket1/Resource'),
          Bucket2: bucket('Stack1/Bucket2/Resource'),
        },
      },
    }]);

    const overrideFile = writeOverrideFile({
      environments: [{
        account: ACCOUNT,
        region: REGION,
        resources: {
          'Stack1.Bucket1': 'Stack1.Bucket3',
          'Stack1.Bucket2': 'Stack1.Bucket4',
        },
      }],
    });

    await toolkit.refactor({ dryRun: true, overrideFile, revert: true });
  });
});

describe('refusals', () => {
  test('--revert without --override-file fails before doing anything', async () => {
    const toolkit = await makeToolkit([{ stackName: 'Stack1', env: ENV, template: { Resources: {} } }]);

    await expect(toolkit.refactor({ dryRun: true, revert: true })).rejects.toThrow(
      'The --revert option can only be used with the --override-file option.',
    );
  });

  test('a refactor that adds or removes resources is rejected', async () => {
    givenDeployedStacks({ Stack1: { Resources: { MyBucket: bucket('Stack1/MyBucket/Resource') } } });

    const toolkit = await makeToolkit([{
      stackName: 'Stack1',
      env: ENV,
      template: {
        Resources: {
          MyBucket: bucket('Stack1/MyBucket/Resource'),
          MyQueue: queue('Stack1/MyQueue/Resource'),
        },
      },
    }]);

    await toolkit.refactor({ dryRun: true });

    expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateStackRefactorCommand);
  });

  test('stacks that are not deployed yet are rejected', async () => {
    givenDeployedStacks({});

    const toolkit = await makeToolkit([{
      stackName: 'Stack1',
      env: ENV,
      template: { Resources: { MyBucket: bucket('Stack1/MyBucket/Resource') } },
    }]);

    await toolkit.refactor({ dryRun: true });

    expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateStackRefactorCommand);
  });
});

describe('execution', () => {
  test('creates and executes the refactor, then deploys the stacks', async () => {
    givenDeployedStacks({ Stack1: { Resources: { OldBucket: bucket('Stack1/OldBucket/Resource') } } });
    givenBootstrapStack('CDKToolkit');

    mockCloudFormationClient.on(CreateStackRefactorCommand).resolves({ StackRefactorId: 'refactor-id' });
    mockCloudFormationClient.on(DescribeStackRefactorCommand).resolves({
      Status: 'CREATE_COMPLETE',
      ExecutionStatus: 'EXECUTE_COMPLETE',
    });
    mockCloudFormationClient.on(ExecuteStackRefactorCommand).resolves({});
    // The stabilization check right after the refactor looks the stack up by
    // its ARN and sees it as stable. Later DescribeStacks calls fall through
    // to the "no stacks" default, so the finalizing deployment exercises the
    // simple create path.
    mockCloudFormationClient.on(DescribeStacksCommand, {
      StackName: `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/Stack1/abcd`,
    }).resolvesOnce({
      Stacks: [
        {
          StackName: 'Stack1',
          CreationTime: new Date(),
          StackStatus: 'UPDATE_COMPLETE',
        },
      ],
    });

    const toolkit = await makeToolkit([{
      stackName: 'Stack1',
      env: ENV,
      template: { Resources: { NewBucket: bucket('Stack1/NewBucket/Resource') } },
    }]);

    await toolkit.refactor({ dryRun: false });

    expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateStackRefactorCommand, {
      ResourceMappings: [
        {
          Source: { StackName: 'Stack1', LogicalResourceId: 'OldBucket' },
          Destination: { StackName: 'Stack1', LogicalResourceId: 'NewBucket' },
        },
      ],
      StackDefinitions: [
        {
          StackName: 'Stack1',
          TemplateBody: JSON.stringify({ Resources: { NewBucket: bucket('Stack1/NewBucket/Resource') } }),
        },
      ],
    });
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteStackRefactorCommand, {
      StackRefactorId: 'refactor-id',
    });
  });

  test('a bootstrap stack that is too old to refactor is rejected', async () => {
    givenDeployedStacks({ Stack1: { Resources: { OldBucket: bucket('Stack1/OldBucket/Resource') } } });
    givenBootstrapStack('CDKToolkit', '27');

    const toolkit = await makeToolkit([{
      stackName: 'Stack1',
      env: ENV,
      template: { Resources: { NewBucket: bucket('Stack1/NewBucket/Resource') } },
    }]);

    await toolkit.refactor({ dryRun: false });

    expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateStackRefactorCommand);
  });
});

describe('large templates', () => {
  test('are uploaded to the bucket of the default toolkit stack', async () => {
    givenDeployedStacks({ Stack1: largeTemplate() });
    givenBootstrapStack('CDKToolkit');

    const toolkit = await makeToolkit([{ stackName: 'Stack1', env: ENV, template: largeTemplateWithRename() }]);

    await toolkit.refactor({ dryRun: true });

    expect(mockS3Client).toHaveReceivedCommandWith(PutObjectCommand, {
      Bucket: 'CDKToolkit-bucket',
    });
  });

  test('are uploaded to the bucket of a custom toolkit stack', async () => {
    // Only `MyCustomToolkit` is bootstrapped; a lookup of the default
    // `CDKToolkit` name would report "not bootstrapped" and fail the refactor.
    givenDeployedStacks({ Stack1: largeTemplate() });
    givenBootstrapStack('MyCustomToolkit');

    const toolkit = await makeToolkit([{ stackName: 'Stack1', env: ENV, template: largeTemplateWithRename() }], 'MyCustomToolkit');

    await toolkit.refactor({ dryRun: true });

    expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeStacksCommand, {
      StackName: 'MyCustomToolkit',
    });
    expect(mockS3Client).toHaveReceivedCommandWith(PutObjectCommand, {
      Bucket: 'MyCustomToolkit-bucket',
    });
  });

  test('fail when the environment is not bootstrapped', async () => {
    givenDeployedStacks({ Stack1: largeTemplate() });

    const toolkit = await makeToolkit([{ stackName: 'Stack1', env: ENV, template: largeTemplateWithRename() }]);

    await toolkit.refactor({ dryRun: true });

    expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateStackRefactorCommand);
  });
});

function writeOverrideFile(content: any): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cdk-refactor-test-'));
  const file = path.join(dir, 'overrides.json');
  fs.writeFileSync(file, JSON.stringify(content));
  return file;
}
