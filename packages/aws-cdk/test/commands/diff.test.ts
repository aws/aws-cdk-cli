import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import type { NestedStackTemplates } from '../../lib/api';
import { Deployments } from '../../lib/api';
import type { ChangeSetReport, IoHelper } from '../../lib/api-private';
import { ChangeSetDescriber, cfnApi, Diagnosis } from '../../lib/api-private';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';

let cloudExecutable: MockCloudExecutable;
let cloudFormation: jest.Mocked<Deployments>;
let toolkit: CdkToolkit;
let oldDir: string;
let tmpDir: string;
let ioHost = CliIoHost.instance();
let notifySpy: jest.SpyInstance<Promise<void>>;

function output() {
  return notifySpy.mock.calls.map(x => x[0].message).join('\n').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

beforeAll(() => {
  // The toolkit writes and checks for temporary files in the current directory,
  // so run these tests in a tempdir so they don't interfere with each other
  // and other tests.
  oldDir = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-cdk-test'));
  process.chdir(tmpDir);
});

afterAll(() => {
  process.chdir(oldDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  notifySpy = jest.spyOn(ioHost, 'notify');
  notifySpy.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fixed template', () => {
  const templatePath = 'oldTemplate.json';
  beforeEach(async () => {
    const oldTemplate = {
      Resources: {
        SomeResource: {
          Type: 'AWS::SomeService::SomeResource',
          Properties: {
            Something: 'old-value',
          },
        },
      },
    };

    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'A',
          template: {
            Resources: {
              SomeResource: {
                Type: 'AWS::SomeService::SomeResource',
                Properties: {
                  Something: 'new-value',
                },
              },
            },
          },
        },
      ],
    }, undefined, ioHost);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    fs.writeFileSync(templatePath, JSON.stringify(oldTemplate));
  });

  afterEach(() => fs.rmSync(templatePath));

  test('fixed template with valid templates', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      method: undefined,
      templatePath,
    });

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput).toContain(`Resources
[~] AWS::SomeService::SomeResource SomeResource
 └─ [~] Something
     ├─ [-] old-value
     └─ [+] new-value
`);

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 1'),
    }));
    expect(exitCode).toBe(0);
  });
});

describe('import existing resources', () => {
  let createDiffChangeSet: jest.SpyInstance<
    Promise<ChangeSetReport | undefined>,
    [ioHelper: IoHelper, options: cfnApi.PrepareChangeSetOptions],
    any
  >;

  beforeEach(async () => {
    // Default implementations
    cloudFormation = instanceMockFrom(Deployments);
    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation(
      (_stackArtifact: CloudFormationStackArtifact) => {
        return Promise.resolve({
          deployedRootTemplate: {
            Resources: {
              MyTable: {
                Type: 'AWS::DynamoDB::Table',
                Properties: {
                  TableName: 'MyTableName-12345ABC',
                },
                DeletionPolicy: 'Retain',
              },
            },
          },
          nestedStacks: {},
        });
      },
    );
    cloudFormation.stackExists = jest.fn().mockReturnValue(Promise.resolve(true));
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'A',
          template: {
            Resources: {
              MyGlobalTable: {
                Type: 'AWS::DynamoDB::GlobalTable',
                Properties: {
                  TableName: 'MyTableName-12345ABC',
                },
              },
            },
          },
        },
      ],
    }, undefined, ioHost);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });
  });

  test('import action in change set output', async () => {
    createDiffChangeSet = jest.spyOn(cfnApi, 'createDiffChangeSet').mockImplementationOnce(async () => {
      return {
        changeSet: {
          $metadata: {},
          Changes: [
            {
              ResourceChange: {
                Action: 'Import',
                LogicalResourceId: 'MyGlobalTable',
              },
            },
          ],
        },
        diagnosis: Diagnosis.noProblem(),
      };
    });

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      method: 'auto',
      importExistingResources: true,
    });

    expect(createDiffChangeSet).toHaveBeenCalled();

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput).toContain(`
Resources
[-] AWS::DynamoDB::Table MyTable orphan
[←] AWS::DynamoDB::GlobalTable MyGlobalTable import
`);

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 1'),
    }));
    expect(exitCode).toBe(0);
  });

  test('import action in change set output when not using --import-exsting-resources', async () => {
    createDiffChangeSet = jest.spyOn(cfnApi, 'createDiffChangeSet').mockImplementationOnce(async () => {
      return {
        changeSet: {
          $metadata: {},
          Changes: [
            {
              ResourceChange: {
                Action: 'Add',
                LogicalResourceId: 'MyGlobalTable',
              },
            },
          ],
        },
        diagnosis: Diagnosis.noProblem(),
      };
    });

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      method: 'auto',
      importExistingResources: false,
    });

    expect(createDiffChangeSet).toHaveBeenCalled();

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput).toContain(`
Resources
[-] AWS::DynamoDB::Table MyTable orphan
[+] AWS::DynamoDB::GlobalTable MyGlobalTable
`);

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 1'),
    }));
    expect(exitCode).toBe(0);
  });

  test('when invoked with method=template', async () => {
    // WHEN
    createDiffChangeSet = jest.spyOn(cfnApi, 'createDiffChangeSet').mockImplementationOnce(async () => {
      return {
        changeSet: {
          $metadata: {},
          Changes: [
            {
              ResourceChange: {
                Action: 'Add',
                LogicalResourceId: 'MyGlobalTable',
              },
            },
          ],
        },
        diagnosis: Diagnosis.noProblem(),
      };
    });

    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      method: 'template',
      importExistingResources: true,
    });

    expect(createDiffChangeSet).not.toHaveBeenCalled();

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput).toContain(`
Resources
[-] AWS::DynamoDB::Table MyTable orphan
[+] AWS::DynamoDB::GlobalTable MyGlobalTable
`);

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 1'),
    }));
    expect(exitCode).toBe(0);
  });

  test('passes the change set name to createDiffChangeSet', async () => {
    createDiffChangeSet = jest.spyOn(cfnApi, 'createDiffChangeSet').mockImplementationOnce(async () => {
      return {
        changeSet: {
          $metadata: {},
          Changes: [
            {
              ResourceChange: {
                Action: 'Add',
                LogicalResourceId: 'MyGlobalTable',
              },
            },
          ],
        },
        diagnosis: Diagnosis.noProblem(),
      };
    });

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      method: 'auto',
      changeSetName: 'my-custom-change-set',
    });

    // THEN
    expect(createDiffChangeSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ changeSetName: 'my-custom-change-set' }),
    );
    expect(exitCode).toBe(0);
  });

  test('when invoked with local template path', async () => {
    const templatePath = 'oldTemplate.json';
    const oldTemplate = {
      Resources: {
        SomeResource: {
          Type: 'AWS::SomeService::SomeResource',
          Properties: {
            Something: 'old-value',
          },
        },
      },
    };
    fs.writeFileSync(templatePath, JSON.stringify(oldTemplate));
    // WHEN
    await expect(async () => {
      await toolkit.diff({
        stackNames: ['A'],
        method: undefined,
        templatePath: templatePath,
        importExistingResources: true,
      });
    }).rejects.toThrow(/Can only use --import-existing-resources flag when comparing against deployed stacks/);
  });
});

describe('imports', () => {
  let createDiffChangeSet: jest.SpyInstance<
    Promise<ChangeSetReport | undefined>,
    [ioHelper: IoHelper, options: cfnApi.PrepareChangeSetOptions],
    any
  >;

  beforeEach(async () => {
    const outputToJson = {
      '//': 'This file is generated by cdk migrate. It will be automatically deleted after the first successful deployment of this app to the environment of the original resources.',
      'Source': 'localfile',
      'Resources': [],
    };
    fs.writeFileSync('migrate.json', JSON.stringify(outputToJson, null, 2));
    createDiffChangeSet = jest.spyOn(cfnApi, 'createDiffChangeSet').mockImplementationOnce(async () => {
      return {
        changeSet: {
          $metadata: {},
          Changes: [
            {
              ResourceChange: {
                Action: 'Import',
                LogicalResourceId: 'Queue',
              },
            },
            {
              ResourceChange: {
                Action: 'Import',
                LogicalResourceId: 'Bucket',
              },
            },
            {
              ResourceChange: {
                Action: 'Import',
                LogicalResourceId: 'Queue2',
              },
            },
          ],
        },
        diagnosis: Diagnosis.noProblem(),
      };
    });
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'A',
          template: {
            Resources: {
              Queue: {
                Type: 'AWS::SQS::Queue',
              },
              Queue2: {
                Type: 'AWS::SQS::Queue',
              },
              Bucket: {
                Type: 'AWS::S3::Bucket',
              },
            },
          },
        },
      ],
    }, undefined, ioHost);

    cloudFormation = instanceMockFrom(Deployments);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    // Default implementations
    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation(
      (_stackArtifact: CloudFormationStackArtifact) => {
        return Promise.resolve({
          deployedRootTemplate: {},
          nestedStacks: {},
        });
      },
    );
    cloudFormation.deployStack.mockImplementation((options) =>
      Promise.resolve({
        type: 'did-deploy-stack',
        noOp: true,
        outputs: {},
        stackArn: '',
        deleteFailures: [],
        stabilizingResources: [],
        stackArtifact: options.stack,
      }),
    );
  });

  afterEach(() => {
    fs.rmSync('migrate.json');
  });

  test('imports render correctly for a nonexistant stack and diff creates a changeset', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      method: 'auto',
    });

    // THEN
    const plainTextOutput = output();
    expect(createDiffChangeSet).toHaveBeenCalled();
    expect(plainTextOutput).toContain(`Stack A
Parameters and rules created during migration do not affect resource configuration.
Resources
[←] AWS::SQS::Queue Queue import
[←] AWS::SQS::Queue Queue2 import
[←] AWS::S3::Bucket Bucket import
`);

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 1'),
    }));
    expect(exitCode).toBe(0);
  });

  test('imports render correctly for an existing stack and diff creates a changeset', async () => {
    // GIVEN
    cloudFormation.stackExists = jest.fn().mockReturnValue(Promise.resolve(true));

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      method: 'auto',
    });

    // THEN
    const plainTextOutput = output();
    expect(createDiffChangeSet).toHaveBeenCalled();
    expect(plainTextOutput).toContain(`Stack A
Parameters and rules created during migration do not affect resource configuration.
Resources
[←] AWS::SQS::Queue Queue import
[←] AWS::SQS::Queue Queue2 import
[←] AWS::S3::Bucket Bucket import
`);

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 1'),
    }));
    expect(exitCode).toBe(0);
  });
});

describe('non-nested stacks', () => {
  test.each([0, -1, 1.5, NaN, Infinity])('rejects invalid diff concurrency %s', async (concurrency) => {
    await expect(toolkit.diff({ stackNames: ['A'], concurrency })).rejects.toThrow('Diff concurrency must be a positive integer');
    expect(cloudFormation.readCurrentTemplateWithNestedStacks).not.toHaveBeenCalled();
  });

  test('prepares two stacks concurrently but formats them in selection order', async () => {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [{ stackName: 'A', template: {} }, { stackName: 'B', template: {} }],
    }, undefined, ioHost);
    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });
    let releaseA!: () => void;
    let releaseB!: () => void;
    let bothStarted!: () => void;
    const started = new Promise<void>(resolve => {
      bothStarted = resolve;
    });
    const gateA = new Promise<void>(resolve => {
      releaseA = resolve;
    });
    const gateB = new Promise<void>(resolve => {
      releaseB = resolve;
    });
    let active = 0;
    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation(async stack => {
      active++;
      if (active === 2) {
        bothStarted();
      }
      await (stack.stackName === 'A' ? gateA : gateB);
      return { deployedRootTemplate: {}, nestedStacks: {} };
    });

    const diff = toolkit.diff({ stackNames: ['A', 'B'], method: 'template', concurrency: 2 });
    await started;
    releaseB();
    releaseA();
    expect(await diff).toBe(0);
    const text = output();
    expect(text).toContain('Stack A');
    expect(text).toContain('Stack B');
    expect(text.indexOf('Stack A')).toBeLessThan(text.indexOf('Stack B'));
  });

  beforeEach(async () => {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'A',
          template: { resource: 'A' },
        },
        {
          stackName: 'B',
          depends: ['A'],
          template: { resource: 'B' },
        },
        {
          stackName: 'C',
          depends: ['A'],
          template: { resource: 'C' },
          metadata: {
            '/resource': [
              {
                type: cxschema.ArtifactMetadataEntryType.ERROR,
                data: 'this is an error',
              },
            ],
          },
        },
        {
          stackName: 'D',
          template: { resource: 'D' },
        },
      ],
    }, undefined, ioHost);

    cloudFormation = instanceMockFrom(Deployments);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    // Default implementations
    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation(
      (stackArtifact: CloudFormationStackArtifact) => {
        if (stackArtifact.stackName === 'D') {
          return Promise.resolve({
            deployedRootTemplate: { resource: 'D' },
            nestedStacks: {},
          });
        }
        return Promise.resolve({
          deployedRootTemplate: {},
          nestedStacks: {},
        });
      },
    );
    cloudFormation.deployStack.mockImplementation((options) =>
      Promise.resolve({
        type: 'did-deploy-stack',
        noOp: true,
        outputs: {},
        stackArn: '',
        deleteFailures: [],
        stabilizingResources: [],
        stackArtifact: options.stack,
      }),
    );
  });

  test('diff can diff multiple stacks', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['B'],
    });

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Stack A');
    expect(plainTextOutput).toContain('Stack B');

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 2'),
    }));
    expect(exitCode).toBe(0);
  });

  test('diff number of stack diffs, not resource diffs', async () => {
    // GIVEN
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'A',
          template: { resourceA: 'A', resourceB: 'B' },
        },
        {
          stackName: 'B',
          template: { resourceC: 'C' },
        },
      ],
    }, undefined, ioHost);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A', 'B'],
    });

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Stack A');
    expect(plainTextOutput).toContain('Stack B');

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 2'),
    }));
    expect(exitCode).toBe(0);
  });

  test('exits with 1 with diffs and fail set to true', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      failOn: cxschema.RequireApproval.ANYCHANGE,
    });

    // THEN
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 1'),
    }));
    expect(exitCode).toBe(1);
  });

  test('throws an error if no valid stack names given', async () => {
    // WHEN
    await expect(() =>
      toolkit.diff({
        stackNames: ['X', 'Y', 'Z'],
      }),
    ).rejects.toThrow('No stacks match the name(s) X,Y,Z');
  });

  test('exits with 1 with diff in first stack, but not in second stack and fail set to true', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A', 'D'],
      failOn: cxschema.RequireApproval.ANYCHANGE,
    });

    // THEN
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 1'),
    }));
    expect(exitCode).toBe(1);
  });

  test('throws an error during diffs on stack with error metadata', async () => {
    // WHEN
    await expect(() =>
      toolkit.diff({
        stackNames: ['C'],
      }),
    ).rejects.toThrow(/Synthesis finished with errors/);
  });

  test('when quiet mode is enabled, stacks with no diffs should not print stack name & no differences to stdout', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['D'],
      failOn: cxschema.RequireApproval.NEVER,
      quiet: true,
    });

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput).not.toContain('Stack D');
    expect(plainTextOutput).not.toContain('There were no differences');
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 0'),
    }));
    expect(exitCode).toBe(0);
  });

  test('when quiet mode is enabled, stacks with diffs should print stack name to stdout', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      failOn: cxschema.RequireApproval.NEVER,
      quiet: true,
    });

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Stack A');
    expect(plainTextOutput).not.toContain('There were no differences');
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 1'),
    }));
    expect(exitCode).toBe(0);
  });
});

describe('stack exists checks', () => {
  beforeEach(async () => {
    jest.resetAllMocks();

    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'A',
          template: { resource: 'A' },
        },
        {
          stackName: 'B',
          depends: ['A'],
          template: { resource: 'B' },
        },
        {
          stackName: 'C',
          depends: ['A'],
          template: { resource: 'C' },
          metadata: {
            '/resource': [
              {
                type: cxschema.ArtifactMetadataEntryType.ERROR,
                data: 'this is an error',
              },
            ],
          },
        },
        {
          stackName: 'D',
          template: { resource: 'D' },
        },
      ],
    }, undefined, ioHost);

    cloudFormation = instanceMockFrom(Deployments);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    // Default implementations
    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation(
      (stackArtifact: CloudFormationStackArtifact) => {
        if (stackArtifact.stackName === 'D') {
          return Promise.resolve({
            deployedRootTemplate: { resource: 'D' },
            nestedStacks: {},
          });
        }
        return Promise.resolve({
          deployedRootTemplate: {},
          nestedStacks: {},
        });
      },
    );
    cloudFormation.deployStack.mockImplementation((options) =>
      Promise.resolve({
        type: 'did-deploy-stack',
        noOp: true,
        outputs: {},
        stackArn: '',
        deleteFailures: [],
        stabilizingResources: [],
        stackArtifact: options.stack,
      }),
    );
  });

  test('diff does not check for stack existence with method=template', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A', 'A'],
      failOn: cxschema.RequireApproval.NEVER,
      quiet: true,
      method: 'template',
    });

    // THEN
    expect(exitCode).toBe(0);
    expect(cloudFormation.stackExists).not.toHaveBeenCalled();
  });

  test('diff creates changeset for new stacks', async () => {
    // GIVEN
    const stackExists = jest.spyOn(cloudFormation, 'stackExists').mockReturnValue(Promise.resolve(false));
    const createDiffChangeSet = jest.spyOn(cfnApi, 'createDiffChangeSet');

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A', 'A'],
      failOn: cxschema.RequireApproval.NEVER,
      quiet: true,
      method: 'auto',
    });

    // THEN
    expect(exitCode).toBe(0);
    expect(stackExists).toHaveBeenCalled();
    expect(createDiffChangeSet).toHaveBeenCalled();
  });

  test('method=auto falls back to template diff when stackExists call fails', async () => {
    // GIVEN
    const stackExists = jest.spyOn(cloudFormation, 'stackExists');
    const createDiffChangeSet = jest.spyOn(cfnApi, 'createDiffChangeSet');

    stackExists.mockImplementation(() => {
      throw new Error('Fail fail fail');
    });

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A', 'A'],
      failOn: cxschema.RequireApproval.NEVER,
      quiet: true,
      method: 'auto',
    });

    // THEN
    expect(exitCode).toBe(0);
    expect(stackExists).toHaveBeenCalled();
    expect(createDiffChangeSet).not.toHaveBeenCalled();
  });

  test('method=change-set throws when stackExists call fails', async () => {
    // GIVEN
    jest.spyOn(cloudFormation, 'stackExists').mockImplementation(() => {
      throw new Error('Fail fail fail');
    });

    // WHEN / THEN
    await expect(toolkit.diff({
      stackNames: ['A'],
      method: 'change-set',
    })).rejects.toThrow(/Could not access stack 'A'/);
  });

  test('method=change-set creates changeset for new stacks', async () => {
    // GIVEN
    jest.spyOn(cloudFormation, 'stackExists').mockReturnValue(Promise.resolve(false));
    const createDiffChangeSet = jest.spyOn(cfnApi, 'createDiffChangeSet').mockResolvedValue(undefined);

    // WHEN
    await toolkit.diff({
      stackNames: ['A'],
      method: 'change-set',
    });

    // THEN
    expect(createDiffChangeSet).toHaveBeenCalled();
  });
});

describe('nested stacks', () => {
  beforeEach(async () => {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'Parent',
          template: {},
        },
        {
          stackName: 'UnchangedParent',
          template: {},
        },
      ],
    }, undefined, ioHost);

    cloudFormation = instanceMockFrom(Deployments);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation(
      (stackArtifact: CloudFormationStackArtifact) => {
        if (stackArtifact.stackName === 'Parent') {
          stackArtifact.template.Resources = {
            AdditionChild: {
              Type: 'AWS::CloudFormation::Stack',
              Properties: {
                TemplateURL: 'addition-child-url-old',
              },
            },
            DeletionChild: {
              Type: 'AWS::CloudFormation::Stack',
              Properties: {
                TemplateURL: 'deletion-child-url-old',
              },
            },
            ChangedChild: {
              Type: 'AWS::CloudFormation::Stack',
              Properties: {
                TemplateURL: 'changed-child-url-old',
              },
            },
            UnchangedChild: {
              Type: 'AWS::CloudFormation::Stack',
              Properties: {
                TemplateURL: 'changed-child-url-constant',
              },
            },
          };
          return Promise.resolve({
            deployedRootTemplate: {
              Resources: {
                AdditionChild: {
                  Type: 'AWS::CloudFormation::Stack',
                  Properties: {
                    TemplateURL: 'addition-child-url-new',
                  },
                },
                DeletionChild: {
                  Type: 'AWS::CloudFormation::Stack',
                  Properties: {
                    TemplateURL: 'deletion-child-url-new',
                  },
                },
                ChangedChild: {
                  Type: 'AWS::CloudFormation::Stack',
                  Properties: {
                    TemplateURL: 'changed-child-url-new',
                  },
                },
                UnchangedChild: {
                  Type: 'AWS::CloudFormation::Stack',
                  Properties: {
                    TemplateURL: 'changed-child-url-constant',
                  },
                },
              },
            },
            nestedStacks: {
              AdditionChild: {
                deployedTemplate: {
                  Resources: {
                    SomeResource: {
                      Type: 'AWS::Something',
                    },
                  },
                },
                generatedTemplate: {
                  Resources: {
                    SomeResource: {
                      Type: 'AWS::Something',
                      Properties: {
                        Prop: 'added-value',
                      },
                    },
                  },
                },
                nestedStackTemplates: {},
                physicalName: 'AdditionChild',
              },
              DeletionChild: {
                deployedTemplate: {
                  Resources: {
                    SomeResource: {
                      Type: 'AWS::Something',
                      Properties: {
                        Prop: 'value-to-be-removed',
                      },
                    },
                  },
                },
                generatedTemplate: {
                  Resources: {
                    SomeResource: {
                      Type: 'AWS::Something',
                    },
                  },
                },
                nestedStackTemplates: {},
                physicalName: 'DeletionChild',
              },
              ChangedChild: {
                deployedTemplate: {
                  Resources: {
                    SomeResource: {
                      Type: 'AWS::Something',
                      Properties: {
                        Prop: 'old-value',
                      },
                    },
                  },
                },
                generatedTemplate: {
                  Resources: {
                    SomeResource: {
                      Type: 'AWS::Something',
                      Properties: {
                        Prop: 'new-value',
                      },
                    },
                  },
                },
                nestedStackTemplates: {},
                physicalName: 'ChangedChild',
              },
              newChild: {
                deployedTemplate: {},
                generatedTemplate: {
                  Resources: {
                    SomeResource: {
                      Type: 'AWS::Something',
                      Properties: {
                        Prop: 'new-value',
                      },
                    },
                  },
                },
                nestedStackTemplates: {
                  newGrandChild: {
                    deployedTemplate: {},
                    generatedTemplate: {
                      Resources: {
                        SomeResource: {
                          Type: 'AWS::Something',
                          Properties: {
                            Prop: 'new-value',
                          },
                        },
                      },
                    },
                    physicalName: undefined,
                    nestedStackTemplates: {},
                  } as NestedStackTemplates,
                },
                physicalName: undefined,
              },
              UnChangedChild: {
                deployedTemplate: {
                  Resources: {
                    SomeResource: {
                      Type: 'AWS::Something',
                      Properties: {
                        Prop: 'unchanged',
                      },
                    },
                  },
                },
                generatedTemplate: {
                  Resources: {
                    SomeResource: {
                      Type: 'AWS::Something',
                      Properties: {
                        Prop: 'unchanged',
                      },
                    },
                  },
                },
                nestedStackTemplates: {},
                physicalName: 'UnChangedChild',
              },
            },
          });
        }
        if (stackArtifact.stackName === 'UnchangedParent') {
          stackArtifact.template.Resources = {
            UnchangedChild: {
              Type: 'AWS::CloudFormation::Stack',
              Properties: {
                TemplateURL: 'child-url',
              },
            },
          };
          return Promise.resolve({
            deployedRootTemplate: {
              Resources: {
                UnchangedChild: {
                  Type: 'AWS::CloudFormation::Stack',
                  Properties: {
                    TemplateURL: 'child-url',
                  },
                },
              },
            },
            nestedStacks: {
              UnchangedChild: {
                deployedTemplate: {
                  Resources: {
                    SomeResource: {
                      Type: 'AWS::Something',
                      Properties: {
                        Prop: 'unchanged',
                      },
                    },
                  },
                },
                generatedTemplate: {
                  Resources: {
                    SomeResource: {
                      Type: 'AWS::Something',
                      Properties: {
                        Prop: 'unchanged',
                      },
                    },
                  },
                },
                nestedStackTemplates: {},
                physicalName: 'UnchangedChild',
              },
            },
          });
        }
        return Promise.resolve({
          deployedRootTemplate: {},
          nestedStacks: {},
        });
      },
    );
  });

  test('diff can diff nested stacks and display the nested stack logical ID if has not been deployed or otherwise has no physical name', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['Parent'],
      method: 'template',
    });

    // THEN
    const plainTextOutput = output().replace(/[ \t]+$/gm, '');
    expect(plainTextOutput.trim()).toContain(`Stack Parent
Resources
[~] AWS::CloudFormation::Stack AdditionChild
 └─ [~] TemplateURL
     ├─ [-] addition-child-url-new
     └─ [+] addition-child-url-old
[~] AWS::CloudFormation::Stack DeletionChild
 └─ [~] TemplateURL
     ├─ [-] deletion-child-url-new
     └─ [+] deletion-child-url-old
[~] AWS::CloudFormation::Stack ChangedChild
 └─ [~] TemplateURL
     ├─ [-] changed-child-url-new
     └─ [+] changed-child-url-old

Stack AdditionChild
Resources
[~] AWS::Something SomeResource
 └─ [+] Prop
     └─ added-value

Stack DeletionChild
Resources
[~] AWS::Something SomeResource
 └─ [-] Prop
     └─ value-to-be-removed

Stack ChangedChild
Resources
[~] AWS::Something SomeResource
 └─ [~] Prop
     ├─ [-] old-value
     └─ [+] new-value

Stack newChild
Resources
[+] AWS::Something SomeResource

Stack newGrandChild
Resources
[+] AWS::Something SomeResource

Stack UnChangedChild
There were no differences`);

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 6'),
    }));

    expect(exitCode).toBe(0);
  });

  test('diff falls back to non-changeset diff for nested stacks', async () => {
    // GIVEN
    const changeSetSpy = jest.spyOn(ChangeSetDescriber.prototype, 'waitAndThrowOnProblem');

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['Parent'],
      method: 'auto',
    });

    // THEN
    const plainTextOutput = output().replace(/[ \t]+$/gm, '');
    expect(plainTextOutput.trim()).toContain(`Stack Parent
Resources
[~] AWS::CloudFormation::Stack AdditionChild
 └─ [~] TemplateURL
     ├─ [-] addition-child-url-new
     └─ [+] addition-child-url-old
[~] AWS::CloudFormation::Stack DeletionChild
 └─ [~] TemplateURL
     ├─ [-] deletion-child-url-new
     └─ [+] deletion-child-url-old
[~] AWS::CloudFormation::Stack ChangedChild
 └─ [~] TemplateURL
     ├─ [-] changed-child-url-new
     └─ [+] changed-child-url-old

Stack AdditionChild
Resources
[~] AWS::Something SomeResource
 └─ [+] Prop
     └─ added-value

Stack DeletionChild
Resources
[~] AWS::Something SomeResource
 └─ [-] Prop
     └─ value-to-be-removed

Stack ChangedChild
Resources
[~] AWS::Something SomeResource
 └─ [~] Prop
     ├─ [-] old-value
     └─ [+] new-value

Stack newChild
Resources
[+] AWS::Something SomeResource

Stack newGrandChild
Resources
[+] AWS::Something SomeResource

Stack UnChangedChild
There were no differences`);

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 6'),
    }));

    expect(exitCode).toBe(0);
    expect(changeSetSpy).not.toHaveBeenCalled();
  });

  test('when quiet mode is enabled, nested stacks with no diffs should not print stack name & no differences to stdout', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['UnchangedParent'],
      failOn: cxschema.RequireApproval.NEVER,
      quiet: true,
    });

    // THEN
    const plainTextOutput = output().replace(/[ \t]+$/gm, '');
    expect(plainTextOutput).not.toContain('Stack UnchangedParent');
    expect(plainTextOutput).not.toContain('There were no differences');
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 0'),
    }));
    expect(exitCode).toBe(0);
  });

  test('when quiet mode is enabled, nested stacks with diffs should print stack name to stdout', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['Parent'],
      failOn: cxschema.RequireApproval.NEVER,
      quiet: true,
    });

    // THEN
    const plainTextOutput = output().replace(/[ \t]+$/gm, '');
    expect(plainTextOutput).toContain(`Stack Parent
Resources
[~] AWS::CloudFormation::Stack AdditionChild
 └─ [~] TemplateURL
     ├─ [-] addition-child-url-new
     └─ [+] addition-child-url-old
[~] AWS::CloudFormation::Stack DeletionChild
 └─ [~] TemplateURL
     ├─ [-] deletion-child-url-new
     └─ [+] deletion-child-url-old
[~] AWS::CloudFormation::Stack ChangedChild
 └─ [~] TemplateURL
     ├─ [-] changed-child-url-new
     └─ [+] changed-child-url-old

Stack AdditionChild
Resources
[~] AWS::Something SomeResource
 └─ [+] Prop
     └─ added-value

Stack DeletionChild
Resources
[~] AWS::Something SomeResource
 └─ [-] Prop
     └─ value-to-be-removed

Stack ChangedChild
Resources
[~] AWS::Something SomeResource
 └─ [~] Prop
     ├─ [-] old-value
     └─ [+] new-value

Stack newChild
Resources
[+] AWS::Something SomeResource

Stack newGrandChild
Resources
[+] AWS::Something SomeResource`);

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 6'),
    }));
    expect(plainTextOutput).not.toContain('Stack UnChangedChild');
    expect(exitCode).toBe(0);
  });

  test('diff --security-only counts nested stacks with security changes', async () => {
    // Override to return nested stacks with IAM
    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation(
      (stackArtifact: CloudFormationStackArtifact) => {
        stackArtifact.template.Resources = {
          IamChild: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'url' } },
          IamChild2: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'url' } },
          NoSecChild: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'url' } },
        };
        return Promise.resolve({
          deployedRootTemplate: {
            Resources: {
              IamChild: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'url' } },
              IamChild2: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'url' } },
              NoSecChild: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'url' } },
            },
          },
          nestedStacks: {
            IamChild: {
              deployedTemplate: {},
              generatedTemplate: {
                Resources: {
                  Role: {
                    Type: 'AWS::IAM::Role',
                    Properties: {
                      AssumeRolePolicyDocument: {
                        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
                      },
                    },
                  },
                },
              },
              physicalName: 'IamChild',
              nestedStackTemplates: {},
            },
            IamChild2: {
              deployedTemplate: {},
              generatedTemplate: {
                Resources: {
                  Role: {
                    Type: 'AWS::IAM::Role',
                    Properties: {
                      AssumeRolePolicyDocument: {
                        Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }],
                      },
                    },
                  },
                },
              },
              physicalName: 'IamChild2',
              nestedStackTemplates: {},
            },
            NoSecChild: {
              deployedTemplate: {},
              generatedTemplate: {
                Resources: { Topic: { Type: 'AWS::SNS::Topic' } },
              },
              physicalName: 'NoSecChild',
              nestedStackTemplates: {},
            },
          },
        });
      },
    );

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['Parent'],
      securityOnly: true,
      method: 'template',
    });

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput).toContain('sts:AssumeRole');
    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 2'),
    }));

    // NoSecChild should show no-changes message
    const lines = plainTextOutput.split('\n');
    const noSecIdx = lines.findIndex(l => l.includes('Stack NoSecChild'));
    expect(noSecIdx).toBeGreaterThanOrEqual(0);
    expect(lines[noSecIdx + 1]).toContain('There were no security-related changes');

    expect(exitCode).toBe(0);
  });

  test('diff --security-only --quiet suppresses stacks without security changes', async () => {
    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation(
      (stackArtifact: CloudFormationStackArtifact) => {
        stackArtifact.template.Resources = {
          IamChild: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'url' } },
          NoSecChild: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'url' } },
        };
        return Promise.resolve({
          deployedRootTemplate: {
            Resources: {
              IamChild: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'url' } },
              NoSecChild: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'url' } },
            },
          },
          nestedStacks: {
            IamChild: {
              deployedTemplate: {},
              generatedTemplate: {
                Resources: {
                  Role: {
                    Type: 'AWS::IAM::Role',
                    Properties: {
                      AssumeRolePolicyDocument: {
                        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
                      },
                    },
                  },
                },
              },
              physicalName: 'IamChild',
              nestedStackTemplates: {},
            },
            NoSecChild: {
              deployedTemplate: {},
              generatedTemplate: {
                Resources: { Topic: { Type: 'AWS::SNS::Topic' } },
              },
              physicalName: 'NoSecChild',
              nestedStackTemplates: {},
            },
          },
        });
      },
    );

    const exitCode = await toolkit.diff({
      stackNames: ['Parent'],
      securityOnly: true,
      quiet: true,
      method: 'template',
    });

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('sts:AssumeRole');
    expect(plainTextOutput).not.toContain('Stack NoSecChild');
    expect(plainTextOutput).not.toContain('There were no security-related changes');
    expect(plainTextOutput).not.toContain('Stack Parent');
    expect(exitCode).toBe(0);
  });
});

describe('--strict', () => {
  const templatePath = 'oldTemplate.json';
  beforeEach(async () => {
    const oldTemplate = {};

    cloudFormation = instanceMockFrom(Deployments);
    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation((_stackArtifact: CloudFormationStackArtifact) => {
      return Promise.resolve({
        deployedRootTemplate: {},
        nestedStacks: {},
      });
    });

    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'A',
          template: {
            Resources: {
              MetadataResource: {
                Type: 'AWS::CDK::Metadata',
                Properties: {
                  newMeta: 'newData',
                },
              },
              SomeOtherResource: {
                Type: 'AWS::Something::Amazing',
              },
            },
            Rules: {
              CheckBootstrapVersion: {
                newCheck: 'newBootstrapVersion',
              },
            },
          },
        },
      ],
    }, undefined, ioHost);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    fs.writeFileSync(templatePath, JSON.stringify(oldTemplate));
  });

  afterEach(() => fs.rmSync(templatePath));

  test('--strict does not obscure CDK::Metadata or CheckBootstrapVersion', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      strict: true,
    });

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput.trim()).toContain(`Stack A
Resources
[+] AWS::CDK::Metadata MetadataResource
[+] AWS::Something::Amazing SomeOtherResource

Other Changes
[+] Unknown Rules: {\"CheckBootstrapVersion\":{\"newCheck\":\"newBootstrapVersion\"}}`);

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 1'),
    }));
    expect(exitCode).toBe(0);
  });

  test('--no-strict obscures CDK::Metadata and CheckBootstrapVersion', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['A'],
    });

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput.trim()).toContain(`Stack A
Resources
[+] AWS::Something::Amazing SomeOtherResource`);

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 1'),
    }));
    expect(exitCode).toBe(0);
  });
});

describe('stack display names', () => {
  beforeEach(async () => {
    cloudFormation = instanceMockFrom(Deployments);
    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation((_stackArtifact: CloudFormationStackArtifact) => {
      return Promise.resolve({
        deployedRootTemplate: {},
        nestedStacks: {},
      });
    });
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'MyParent',
          displayName: 'Parent/NestedStack',
          template: { resource: 'ParentStack' },
        },
        {
          stackName: 'MyChild',
          displayName: 'Parent/NestedStack/MyChild',
          template: { resource: 'ChildStack' },
        },
      ],
    }, undefined, ioHost);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });
  });

  test('diff should display stack paths instead of logical IDs', async () => {
    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['Parent/NestedStack', 'Parent/NestedStack/MyChild'],
    });

    // THEN
    const plainTextOutput = output();

    // Verify that the display name (path) is shown instead of the logical ID
    expect(plainTextOutput).toContain('Stack Parent/NestedStack/MyChild');
    expect(plainTextOutput).not.toContain('Stack MyChild');

    expect(plainTextOutput).toContain('Stack Parent/NestedStack');
    expect(plainTextOutput).not.toContain('Stack MyParent');

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('✨  Number of stacks with differences: 2'),
    }));
    expect(exitCode).toBe(0);
  });

  test('diff should fall back to logical ID if display name is not available', async () => {
    // Create a new cloud executable with stacks that don't have display names
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'NoDisplayNameStack',
          // No displayName provided
          template: { resource: 'ParentStack' },
        },
      ],
    }, undefined, ioHost);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });

    // WHEN
    const exitCode = await toolkit.diff({
      stackNames: ['NoDisplayNameStack'],
    });

    // THEN
    const plainTextOutput = output();

    // Verify that the logical ID is shown when display name is not available
    expect(plainTextOutput).toContain('Stack NoDisplayNameStack');

    expect(exitCode).toBe(0);
  });
});

describe('environment annotation', () => {
  const templatePath = 'oldTemplateForEnv.json';

  beforeEach(async () => {
    cloudFormation = instanceMockFrom(Deployments);
    cloudFormation.readCurrentTemplateWithNestedStacks.mockImplementation(
      (_stackArtifact: CloudFormationStackArtifact) => {
        return Promise.resolve({
          deployedRootTemplate: {},
          nestedStacks: {},
        });
      },
    );
  });

  async function setUpToolkit(env?: string) {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'A',
          env,
          template: {
            Resources: {
              SomeResource: {
                Type: 'AWS::SomeService::SomeResource',
                Properties: { Something: 'new-value' },
              },
            },
          },
        },
      ],
    }, undefined, ioHost);

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });
  }

  test('the stack header shows the environment the stack will be deployed to', async () => {
    // GIVEN - mocked here rather than in beforeEach, so that every other test in
    // this file keeps resolving `undefined` and its header assertions keep holding
    cloudFormation.resolveEnvironment.mockResolvedValue({
      name: 'aws://123456789012/us-east-1',
      account: '123456789012',
      region: 'us-east-1',
    });
    await setUpToolkit();

    // WHEN
    const exitCode = await toolkit.diff({ stackNames: ['A'] });

    // THEN
    expect(output()).toContain('Stack A (aws://123456789012/us-east-1)');
    expect(exitCode).toBe(0);
  });

  test('the stack header is unannotated when the environment cannot be resolved', async () => {
    // GIVEN - resolveEnvironment left returning undefined
    await setUpToolkit();

    // WHEN
    const exitCode = await toolkit.diff({ stackNames: ['A'] });

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Stack A\n');
    expect(plainTextOutput).not.toContain('aws://');
    expect(exitCode).toBe(0);
  });

  test('an environment-agnostic stack shows the resolved environment, not unknown-*', async () => {
    // GIVEN - the reported case in aws/aws-cdk-cli#286: the artifact is
    // environment-agnostic, but the CLI still resolves a concrete target
    cloudFormation.resolveEnvironment.mockResolvedValue({
      name: 'aws://123456789012/eu-west-1',
      account: '123456789012',
      region: 'eu-west-1',
    });
    await setUpToolkit('aws://unknown-account/unknown-region');

    // WHEN
    const exitCode = await toolkit.diff({ stackNames: ['A'] });

    // THEN
    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Stack A (aws://123456789012/eu-west-1)');
    expect(plainTextOutput).not.toContain('unknown-account');
    expect(plainTextOutput).not.toContain('unknown-region');
    expect(exitCode).toBe(0);
  });

  test('diffing against a local template does not resolve the environment', async () => {
    // GIVEN - `cdk diff --template` must stay entirely offline; resolving an
    // environment reaches STS and can throw for unresolved accounts
    await setUpToolkit();
    fs.writeFileSync(templatePath, JSON.stringify({
      Resources: {
        SomeResource: {
          Type: 'AWS::SomeService::SomeResource',
          Properties: { Something: 'old-value' },
        },
      },
    }));

    try {
      // WHEN
      const exitCode = await toolkit.diff({
        stackNames: ['A'],
        method: undefined,
        templatePath,
      });

      // THEN
      expect(cloudFormation.resolveEnvironment).not.toHaveBeenCalled();
      expect(output()).not.toContain('aws://');
      expect(exitCode).toBe(0);
    } finally {
      fs.rmSync(templatePath);
    }
  });
});

describe('--fail-on', () => {
  const deployedTemplate = {
    Resources: {
      Queue: { Type: 'AWS::SQS::Queue', Properties: { VisibilityTimeout: 30 } },
    },
  };

  const broadeningResources = {
    ...deployedTemplate.Resources,
    Role: {
      Type: 'AWS::IAM::Role',
      Properties: {
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
        },
      },
    },
  };

  const updatedResources = {
    Queue: { Type: 'AWS::SQS::Queue', Properties: { VisibilityTimeout: 60 } },
  };

  async function setup(newResources: Record<string, any>) {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [{ stackName: 'A', template: { Resources: newResources } }],
    }, undefined, ioHost);

    cloudFormation = instanceMockFrom(Deployments);
    cloudFormation.readCurrentTemplateWithNestedStacks.mockResolvedValue({
      deployedRootTemplate: deployedTemplate,
      nestedStacks: {},
    });

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });
  }

  test.each([
    [cxschema.RequireApproval.ANYCHANGE, updatedResources, 1],
    [cxschema.RequireApproval.ANYCHANGE, broadeningResources, 1],
    [cxschema.RequireApproval.ANYCHANGE, deployedTemplate.Resources, 0],
    [cxschema.RequireApproval.BROADENING, updatedResources, 0],
    [cxschema.RequireApproval.BROADENING, broadeningResources, 1],
    [cxschema.RequireApproval.NEVER, broadeningResources, 0],
  ])('--fail-on=%s exits with the expected code (case %#)', async (failOn, newResources, expectedExitCode) => {
    await setup(newResources);

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', failOn });

    expect(exitCode).toBe(expectedExitCode);
  });

  test('--fail-on=broadening still prints the full diff', async () => {
    await setup({ ...broadeningResources, ...updatedResources });

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', failOn: cxschema.RequireApproval.BROADENING });

    expect(output()).toContain('VisibilityTimeout');
    expect(output()).toContain('AWS::IAM::Role');
    expect(exitCode).toBe(1);
  });

  test('--fail-on=broadening works with --security-only', async () => {
    await setup(broadeningResources);

    const exitCode = await toolkit.diff({
      stackNames: ['A'],
      method: 'template',
      securityOnly: true,
      failOn: cxschema.RequireApproval.BROADENING,
    });

    expect(exitCode).toBe(1);
  });

  test('--fail-on=broadening works when comparing against a local template', async () => {
    const templatePath = 'fail-on-old-template.json';
    fs.writeFileSync(templatePath, JSON.stringify(deployedTemplate));
    try {
      await setup(broadeningResources);

      const exitCode = await toolkit.diff({ stackNames: ['A'], templatePath, failOn: cxschema.RequireApproval.BROADENING });

      expect(exitCode).toBe(1);
    } finally {
      fs.rmSync(templatePath);
    }
  });

  test('--fail-on=broadening detects broadening changes in nested stacks', async () => {
    await setup(deployedTemplate.Resources);
    cloudFormation.readCurrentTemplateWithNestedStacks.mockResolvedValue({
      deployedRootTemplate: deployedTemplate,
      nestedStacks: {
        Nested: {
          physicalName: 'NestedStack',
          deployedTemplate: {},
          generatedTemplate: { Resources: { Role: broadeningResources.Role } },
          nestedStackTemplates: {},
        },
      },
    });

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', failOn: cxschema.RequireApproval.BROADENING });

    expect(exitCode).toBe(1);
  });

  test('--fail-on=broadening works with --security-only when comparing against a local template', async () => {
    const templatePath = 'fail-on-security-only-old-template.json';
    fs.writeFileSync(templatePath, JSON.stringify(deployedTemplate));
    try {
      await setup(broadeningResources);

      const exitCode = await toolkit.diff({
        stackNames: ['A'],
        templatePath,
        securityOnly: true,
        failOn: cxschema.RequireApproval.BROADENING,
      });

      expect(exitCode).toBe(1);
    } finally {
      fs.rmSync(templatePath);
    }
  });

  test('does not fail by default', async () => {
    await setup(broadeningResources);

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template' });

    expect(exitCode).toBe(0);
  });
});

describe('--fail-on=destructive', () => {
  const deployedTemplate = {
    Resources: {
      Queue: { Type: 'AWS::SQS::Queue', Properties: { VisibilityTimeout: 30 } },
      Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'old-name' } },
      Topic: { Type: 'AWS::SNS::Topic' },
      Table: { Type: 'AWS::DynamoDB::Table', DeletionPolicy: 'Retain', Properties: {} },
    },
  };

  async function setup(
    newResources: Record<string, any>,
    nestedStacks: Record<string, NestedStackTemplates> = {},
    metadata?: Record<string, cxschema.MetadataEntry[]>,
  ) {
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [{ stackName: 'A', template: { Resources: newResources }, metadata }],
    }, undefined, ioHost);

    cloudFormation = instanceMockFrom(Deployments);
    cloudFormation.readCurrentTemplateWithNestedStacks.mockResolvedValue({
      deployedRootTemplate: deployedTemplate,
      nestedStacks,
    });

    toolkit = new CdkToolkit({
      cloudExecutable,
      deployments: cloudFormation,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
    });
  }

  test('does not fail when the diff only updates resources in place', async () => {
    await setup({
      ...deployedTemplate.Resources,
      Queue: { Type: 'AWS::SQS::Queue', Properties: { VisibilityTimeout: 60 } },
      NewTopic: { Type: 'AWS::SNS::Topic' },
    });

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', failOn: cxschema.RequireApproval.DESTRUCTIVE });

    expect(output()).toContain('Number of stacks with differences: 1');
    expect(output()).not.toContain('destructive change');
    expect(exitCode).toBe(0);
  });

  test('fails and lists replaced, destroyed and orphaned resources', async () => {
    await setup({
      Queue: deployedTemplate.Resources.Queue,
      Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'new-name' } },
    });

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', failOn: cxschema.RequireApproval.DESTRUCTIVE });

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('❌  Found 3 destructive change(s) (--fail-on=destructive):');
    expect(plainTextOutput).toContain('A: AWS::S3::Bucket Bucket will be replaced');
    expect(plainTextOutput).toContain('A: AWS::SNS::Topic Topic will be destroyed');
    expect(plainTextOutput).toContain('A: AWS::DynamoDB::Table Table will be orphaned');
    expect(exitCode).toBe(1);
  });

  test('shows the construct path of a resource like the diff does', async () => {
    await setup({ Queue: deployedTemplate.Resources.Queue, Bucket: deployedTemplate.Resources.Bucket, Table: deployedTemplate.Resources.Table });
    cloudFormation.readCurrentTemplateWithNestedStacks.mockResolvedValue({
      deployedRootTemplate: {
        Resources: {
          ...deployedTemplate.Resources,
          Topic: { Type: 'AWS::SNS::Topic', Metadata: { 'aws:cdk:path': 'A/MyConstruct/Topic/Resource' } },
        },
      },
      nestedStacks: {},
    });

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', failOn: cxschema.RequireApproval.DESTRUCTIVE });

    expect(output()).toContain('[-] AWS::SNS::Topic MyConstruct/Topic Topic destroy');
    expect(output()).toContain('A: AWS::SNS::Topic MyConstruct/Topic Topic will be destroyed');
    expect(exitCode).toBe(1);
  });

  test('takes the construct path from the cloud assembly like the diff does', async () => {
    // The template has no aws:cdk:path metadata, but the cloud assembly knows the path
    await setup(
      { ...deployedTemplate.Resources, Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'new-name' } } },
      {},
      { '/A/MyConstruct/Bucket/Resource': [{ type: cxschema.ArtifactMetadataEntryType.LOGICAL_ID, data: 'Bucket' }] },
    );

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', failOn: cxschema.RequireApproval.DESTRUCTIVE });

    expect(output()).toContain('[~] AWS::S3::Bucket MyConstruct/Bucket Bucket replace');
    expect(output()).toContain('A: AWS::S3::Bucket MyConstruct/Bucket Bucket will be replaced');
    expect(exitCode).toBe(1);
  });

  test.each([
    [cxschema.RequireApproval.NEVER, 0],
    [cxschema.RequireApproval.BROADENING, 0],
    [cxschema.RequireApproval.ANYCHANGE, 1],
  ])('does not check destructive changes with --fail-on=%s', async (failOn, expectedExitCode) => {
    await setup({ Queue: deployedTemplate.Resources.Queue });

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', failOn });

    expect(output()).not.toContain('destructive change');
    expect(exitCode).toBe(expectedExitCode);
  });

  test('detects destructive changes in nested stacks', async () => {
    await setup({ ...deployedTemplate.Resources }, {
      Nested: {
        physicalName: 'NestedStackPhysicalName',
        deployedTemplate: { Resources: { NestedTopic: { Type: 'AWS::SNS::Topic' } } },
        generatedTemplate: { Resources: {} },
        nestedStackTemplates: {},
      },
    });

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', failOn: cxschema.RequireApproval.DESTRUCTIVE });

    expect(output()).toContain('NestedStackPhysicalName: AWS::SNS::Topic NestedTopic will be destroyed');
    expect(exitCode).toBe(1);
  });

  test('detects destructive changes with --security-only', async () => {
    await setup({ Queue: deployedTemplate.Resources.Queue, Bucket: deployedTemplate.Resources.Bucket, Table: deployedTemplate.Resources.Table });

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', securityOnly: true, failOn: cxschema.RequireApproval.DESTRUCTIVE });

    expect(output()).toContain('A: AWS::SNS::Topic Topic will be destroyed');
    expect(exitCode).toBe(1);
  });

  test('does not fail on replacements that the change set says will not happen', async () => {
    await setup({ ...deployedTemplate.Resources, Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'new-name' } } });
    cloudFormation.stackExists = jest.fn().mockResolvedValue(true);
    jest.spyOn(cfnApi, 'createDiffChangeSet').mockResolvedValue({
      changeSet: {
        $metadata: {},
        Changes: [{
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'Bucket',
            ResourceType: 'AWS::S3::Bucket',
            Replacement: 'False',
            Details: [{
              Evaluation: 'Static',
              Target: { Attribute: 'Properties', Name: 'BucketName', RequiresRecreation: 'Never' },
            }],
          },
        }],
      },
      diagnosis: Diagnosis.noProblem(),
    });

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'change-set', failOn: cxschema.RequireApproval.DESTRUCTIVE });

    expect(output()).toContain('BucketName');
    expect(output()).not.toContain('destructive change');
    expect(exitCode).toBe(0);
  });

  test('does not fail on changes that are omitted as mangled non-ASCII characters', async () => {
    await setup({
      ...deployedTemplate.Resources,
      Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: '文字化け' } },
    });
    cloudFormation.readCurrentTemplateWithNestedStacks.mockResolvedValue({
      deployedRootTemplate: {
        Resources: { ...deployedTemplate.Resources, Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: '????' } } },
      },
      nestedStacks: {},
    });

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', failOn: cxschema.RequireApproval.DESTRUCTIVE });

    expect(output()).toContain('Omitted 1 changes');
    expect(output()).not.toContain('destructive change');
    expect(exitCode).toBe(0);
  });

  test('does not fail when only CDK metadata is removed', async () => {
    await setup({ ...deployedTemplate.Resources });
    cloudFormation.readCurrentTemplateWithNestedStacks.mockResolvedValue({
      deployedRootTemplate: {
        Resources: { ...deployedTemplate.Resources, CDKMetadata: { Type: 'AWS::CDK::Metadata', Properties: { Analytics: 'v2' } } },
      },
      nestedStacks: {},
    });

    const exitCode = await toolkit.diff({ stackNames: ['A'], method: 'template', securityOnly: true, failOn: cxschema.RequireApproval.DESTRUCTIVE });

    expect(output()).not.toContain('destructive change');
    expect(exitCode).toBe(0);
  });

  test('detects destructive changes when comparing against a local template', async () => {
    const templatePath = 'destructive-old-template.json';
    fs.writeFileSync(templatePath, JSON.stringify(deployedTemplate));
    try {
      await setup({ ...deployedTemplate.Resources, Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'new-name' } } });

      const exitCode = await toolkit.diff({ stackNames: ['A'], templatePath, failOn: cxschema.RequireApproval.DESTRUCTIVE });

      expect(output()).toContain('A: AWS::S3::Bucket Bucket will be replaced');
      expect(exitCode).toBe(1);
    } finally {
      fs.rmSync(templatePath);
    }
  });
});
