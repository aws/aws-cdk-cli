import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import * as chalk from 'chalk';
import { templateContainsNestedStacks } from '../../../lib/api/cloudformation/nested-stack-helpers';
import { DiffFormatter } from '../../../lib/api/diff/diff-formatter';

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function expectLineAfter(output: string, marker: string, expected: string) {
  const lines = stripAnsi(output).split('\n');
  const idx = lines.findIndex(l => l.includes(marker));
  expect(idx).toBeGreaterThanOrEqual(0);
  expect(lines[idx + 1]).toContain(expected);
}

describe('formatStackDiff', () => {
  let mockNewTemplate: cxapi.CloudFormationStackArtifact;

  beforeEach(() => {
    mockNewTemplate = {
      template: {
        Resources: {
          Func: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Code: {
                S3Bucket: 'XXXXXXXXXXX',
                S3Key: 'some-key',
              },
              Handler: 'index.handler',
              Runtime: 'nodejs14.x',
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;
  });

  test('returns no differences when templates are identical', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: mockNewTemplate.template,
        newTemplate: mockNewTemplate,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(0);
    expect(result.formattedDiff).toBeDefined();
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toBe(
      'Stack test-stack\n' +
      'There were no differences',
    );
  });

  test('formats differences when changes exist', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(1);
    expect(result.formattedDiff).toBeDefined();
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toBe(
      'Stack test-stack\n' +
      'Resources\n' +
      '[+] AWS::Lambda::Function Func',
    );
  });

  test('formats differences with isImport', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        isImport: true,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(1);
    expect(result.formattedDiff).toBeDefined();
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toBe(
      'Stack test-stack\n' +
      'Parameters and rules created during migration do not affect resource configuration.\n' +
      'Resources\n' +
      '[←] AWS::Lambda::Function Func import',
    );
  });

  test('formats differences showing resource moves', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        mappings: {
          'test-stack.OldName': 'test-stack.Func',
        },
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.formattedDiff).toBeDefined();
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toBe(
      'Stack test-stack\n' +
      'Resources\n' +
      '[+] AWS::Lambda::Function Func (OR move from test-stack.OldName via refactoring)',
    );
  });

  test('nested stacks without changes are not counted', () => {
    const nestedStacks = {
      NestedStack1: {
        deployedTemplate: {},
        generatedTemplate: {},
        physicalName: 'nested-stack-1',
        nestedStackTemplates: {
          NestedStack2: {
            deployedTemplate: {},
            generatedTemplate: {},
            physicalName: 'nested-stack-2',
            nestedStackTemplates: {},
          },
        },
      },
    };

    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        nestedStacks,
      },
    });
    const result = formatter.formatStackDiff();

    // Only root stack has changes (Func resource), nested stacks have no diff
    expect(result.numStacksWithChanges).toBe(1);
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('test-stack')}`);
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('nested-stack-1')}`);
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('nested-stack-2')}`);
  });

  test('nested stacks with changes are counted', () => {
    const rootTemplate = {
      Resources: {
        Nested: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'https://url' } },
      },
    };

    let _template = rootTemplate;
    const mockArtifact = {
      get template() {
        return _template;
      },
      set _template(v: any) {
        _template = v;
      },
      templateFile: 'template.json',
      stackName: 'root-stack',
      findMetadataByType: () => [],
    } as any;

    const nestedStacks = {
      Nested: {
        deployedTemplate: {
          Resources: { Topic: { Type: 'AWS::SNS::Topic', Properties: { DisplayName: 'old' } } },
        },
        generatedTemplate: {
          Resources: { Topic: { Type: 'AWS::SNS::Topic', Properties: { DisplayName: 'new' } } },
        },
        physicalName: 'nested-stack-1',
        nestedStackTemplates: {
          DeeplyNested: {
            deployedTemplate: {
              Resources: { Queue: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'old-q' } } },
            },
            generatedTemplate: {
              Resources: { Queue: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'new-q' } } },
            },
            physicalName: 'nested-stack-2',
            nestedStackTemplates: {},
          },
        },
      },
    };

    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: rootTemplate,
        newTemplate: mockArtifact,
        nestedStacks,
      },
    });
    const result = formatter.formatStackDiff();

    expect(result.numStacksWithChanges).toBe(2);
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('nested-stack-1')}`);
    expect(result.formattedDiff).toContain('AWS::SNS::Topic');
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('nested-stack-2')}`);
    expect(result.formattedDiff).toContain('AWS::SQS::Queue');
  });

  test('passes per-nested-stack changeset to fullDiff', () => {
    // A changeset that says the resource has NO property changes filters out
    // false positives that the template diff would otherwise report.
    const nestedChangeSet = { Changes: [], $metadata: {} };

    const rootTemplate = {
      Resources: {
        Nested: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'https://url' } },
      },
    };

    let _template = rootTemplate;
    const mockArtifact = {
      get template() {
        return _template;
      },
      set _template(v: any) {
        _template = v;
      },
      templateFile: 'template.json',
      stackName: 'root-stack',
      findMetadataByType: () => [],
    } as any;

    // Template diff sees a metadata change, but the changeset says there are no real changes
    const deployed = {
      Resources: { Res: { Type: 'AWS::SNS::Topic', Metadata: { 'aws:cdk:path': 'old/path' } } },
    };
    const generated = {
      Resources: { Res: { Type: 'AWS::SNS::Topic', Metadata: { 'aws:cdk:path': 'new/path' } } },
    };

    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: rootTemplate,
        newTemplate: mockArtifact,
        nestedStacks: {
          Nested: {
            deployedTemplate: deployed,
            generatedTemplate: generated,
            physicalName: 'nested-stack-1',
            nestedStackTemplates: {},
            changeSet: nestedChangeSet,
          },
        },
      },
    });
    formatter.formatStackDiff();

    // With the changeset (empty Changes), the metadata-only diff is filtered out
    const nestedDiff = formatter.diffs['nested-stack-1'];
    expect(nestedDiff).toBeDefined();
    // Changeset says no changes — all template differences are filtered as false positives
    expect(nestedDiff.differenceCount).toBe(0);
  });

  test('nested stack without changeset reports template-based differences', () => {
    const rootTemplate = {
      Resources: {
        Nested: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'https://url' } },
      },
    };

    let _template = rootTemplate;
    const mockArtifact = {
      get template() {
        return _template;
      },
      set _template(v: any) {
        _template = v;
      },
      templateFile: 'template.json',
      stackName: 'root-stack',
      findMetadataByType: () => [],
    } as any;

    // Same metadata change, but no changeset to filter it out
    const deployed = {
      Resources: { Res: { Type: 'AWS::SNS::Topic', Metadata: { 'aws:cdk:path': 'old/path' } } },
    };
    const generated = {
      Resources: { Res: { Type: 'AWS::SNS::Topic', Metadata: { 'aws:cdk:path': 'new/path' } } },
    };

    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: rootTemplate,
        newTemplate: mockArtifact,
        nestedStacks: {
          Nested: {
            deployedTemplate: deployed,
            generatedTemplate: generated,
            physicalName: 'nested-stack-1',
            nestedStackTemplates: {},
            // no changeSet
          },
        },
      },
    });
    formatter.formatStackDiff();

    // Without a changeset, the template diff reports the metadata change as a real difference
    const nestedDiff = formatter.diffs['nested-stack-1'];
    expect(nestedDiff).toBeDefined();
    // Template-only diff: the resource has a metadata difference
    expect(nestedDiff.differenceCount).toBeGreaterThan(0);
  });
});

describe('formatSecurityDiff', () => {
  let mockNewTemplate: cxapi.CloudFormationStackArtifact;

  beforeEach(() => {
    mockNewTemplate = {
      template: {
        Resources: {
          Role: {
            Type: 'AWS::IAM::Role',
            Properties: {
              AssumeRolePolicyDocument: {
                Version: '2012-10-17',
                Statement: [{
                  Effect: 'Allow',
                  Principal: {
                    Service: 'lambda.amazonaws.com',
                  },
                  Action: 'sts:AssumeRole',
                }],
              },
              ManagedPolicyArns: [
                'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
              ],
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;
  });

  test('returns information on security changes for the IoHost to interpret', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: mockNewTemplate.template,
        newTemplate: mockNewTemplate,
      },
    });
    const result = formatter.formatSecurityDiff();

    // THEN
    expect(result.permissionChangeType).toEqual('none');
  });

  test('returns formatted diff for broadening security changes', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
      },
    });
    const result = formatter.formatSecurityDiff();

    // THEN
    expect(result.permissionChangeType).toEqual('broadening');
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toBe(
      'Stack test-stack\n' +
      'IAM Statement Changes\n' +
      '┌───┬─────────────┬────────┬────────────────┬──────────────────────────────┬───────────┐\n' +
      '│   │ Resource    │ Effect │ Action         │ Principal                    │ Condition │\n' +
      '├───┼─────────────┼────────┼────────────────┼──────────────────────────────┼───────────┤\n' +
      '│ + │ ${Role.Arn} │ Allow  │ sts:AssumeRole │ Service:lambda.amazonaws.com │           │\n' +
      '└───┴─────────────┴────────┴────────────────┴──────────────────────────────┴───────────┘\n' +
      'IAM Policy Changes\n' +
      '┌───┬──────────┬──────────────────────────────────────────────────────────────────┐\n' +
      '│   │ Resource │ Managed Policy ARN                                               │\n' +
      '├───┼──────────┼──────────────────────────────────────────────────────────────────┤\n' +
      '│ + │ ${Role}  │ arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole │\n' +
      '└───┴──────────┴──────────────────────────────────────────────────────────────────┘\n' +
      '(NOTE: There may be security-related changes not in this list. See https://github.com/aws/aws-cdk/issues/1299)',
    );
  });

  test('detects broadening security changes in nested stacks and counts correctly', () => {
    const rootTemplate = {
      Resources: {
        Nested1: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'https://url' } },
        Nested2: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'https://url' } },
      },
    };

    const mockArtifact = {
      template: rootTemplate,
      templateFile: 'template.json',
      stackName: 'root-stack',
      findMetadataByType: () => [],
    } as any;

    const nestedIamTemplate = {
      Resources: {
        NestedRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            AssumeRolePolicyDocument: {
              Version: '2012-10-17',
              Statement: [{
                Effect: 'Allow',
                Principal: { Service: 'ec2.amazonaws.com' },
                Action: 'sts:AssumeRole',
              }],
            },
          },
        },
      },
    };

    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: rootTemplate,
        newTemplate: mockArtifact,
        nestedStacks: {
          Nested1: {
            deployedTemplate: {},
            generatedTemplate: nestedIamTemplate,
            physicalName: 'nested-security-1',
            nestedStackTemplates: {},
          },
          Nested2: {
            deployedTemplate: {},
            generatedTemplate: nestedIamTemplate,
            physicalName: 'nested-security-2',
            nestedStackTemplates: {},
          },
        },
      },
    });
    const result = formatter.formatSecurityDiff();

    expect(result.permissionChangeType).toEqual('broadening');
    expect(result.numStacksWithChanges).toBe(2);
    const sanitized = stripAnsi(result.formattedDiff);
    expect(sanitized).toContain('sts:AssumeRole');
    expect(sanitized).toContain('ec2.amazonaws.com');

    // Root stack has no security changes — message should follow its header
    expectLineAfter(result.formattedDiff, 'Stack root-stack', 'There were no security-related changes');

    // Both nested stacks with IAM should be listed
    expect(sanitized).toContain('Stack nested-security-1');
    expect(sanitized).toContain('Stack nested-security-2');
  });

  test('stacks without security changes show no-changes message', () => {
    const rootTemplate = {
      Resources: {
        Nested: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'https://url' } },
      },
    };

    const mockArtifact = {
      template: rootTemplate,
      templateFile: 'template.json',
      stackName: 'root-stack',
      findMetadataByType: () => [],
    } as any;

    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: rootTemplate,
        newTemplate: mockArtifact,
        nestedStacks: {
          Nested: {
            deployedTemplate: {},
            generatedTemplate: { Resources: { Bucket: { Type: 'AWS::S3::Bucket' } } },
            physicalName: 'no-security-stack',
            nestedStackTemplates: {},
          },
        },
      },
    });
    const result = formatter.formatSecurityDiff();

    expect(result.permissionChangeType).toEqual('none');
    expect(result.numStacksWithChanges).toBe(0);

    // No-changes message should follow the nested stack header
    expectLineAfter(result.formattedDiff, 'Stack no-security-stack', 'There were no security-related changes');
  });
});

describe('mangled character filtering', () => {
  test('filters mangled non-ASCII diffs for root stacks', () => {
    const oldTemplate = {
      Description: '????',
      Resources: { Bucket: { Type: 'AWS::S3::Bucket' } },
    };

    const newTemplate = {
      template: {
        Description: '文字化け',
        Resources: { Bucket: { Type: 'AWS::S3::Bucket' } },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    const formatter = new DiffFormatter({
      templateInfo: { oldTemplate, newTemplate },
    });

    const result = formatter.formatStackDiff();
    const sanitized = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

    expect(result.numStacksWithChanges).toBe(0);
    expect(sanitized).toContain('Omitted');
    expect(sanitized).toContain('There were no differences');
  });

  test('does not filter mangled diffs when strict is true', () => {
    const oldTemplate = {
      Description: '????',
      Resources: { Bucket: { Type: 'AWS::S3::Bucket' } },
    };

    const newTemplate = {
      template: {
        Description: '文字化け',
        Resources: { Bucket: { Type: 'AWS::S3::Bucket' } },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    const formatter = new DiffFormatter({
      templateInfo: { oldTemplate, newTemplate },
    });

    const result = formatter.formatStackDiff({ strict: true });
    const sanitized = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

    expect(result.numStacksWithChanges).toBe(1);
    expect(sanitized).not.toContain('Omitted');
    expect(sanitized).toContain('Description');
  });

  test('does not filter when diffs are real, not mangled', () => {
    const oldTemplate = {
      Resources: { Bucket: { Type: 'AWS::S3::Bucket' } },
    };

    const newTemplate = {
      template: {
        Resources: {
          Bucket: { Type: 'AWS::S3::Bucket' },
          Queue: { Type: 'AWS::SQS::Queue' },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    const formatter = new DiffFormatter({
      templateInfo: { oldTemplate, newTemplate },
    });

    const result = formatter.formatStackDiff();
    const sanitized = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

    expect(result.numStacksWithChanges).toBe(1);
    expect(sanitized).not.toContain('Omitted');
    expect(sanitized).toContain('AWS::SQS::Queue');
  });

  test('filters mangled characters using the nested stack deployed template', () => {
    const nestedDeployed = {
      Description: '????',
      Resources: { Bucket: { Type: 'AWS::S3::Bucket' } },
    };

    const nestedGenerated = {
      Description: '文字化け',
      Resources: { Bucket: { Type: 'AWS::S3::Bucket' } },
    };

    const rootTemplate = {
      Resources: {
        Nested: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'https://url' } },
      },
    };

    let _template = rootTemplate;
    const mockArtifact = {
      get template() {
        return _template;
      },
      set _template(v: any) {
        _template = v;
      },
      templateFile: 'template.json',
      stackName: 'root-stack',
      findMetadataByType: () => [],
    } as any;

    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: rootTemplate,
        newTemplate: mockArtifact,
        nestedStacks: {
          Nested: {
            deployedTemplate: nestedDeployed,
            generatedTemplate: nestedGenerated,
            physicalName: 'nested-stack',
            nestedStackTemplates: {},
          },
        },
      },
    });

    const result = formatter.formatStackDiff();
    const sanitized = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

    expect(sanitized).not.toContain('AWS::CloudFormation::Stack');
    expect(sanitized).toContain('nested-stack');
    expect(sanitized).toContain('Omitted');
  });
});

describe('duplicate logical ids in nested stacks', () => {
  test('shows correct path for parent resource when nested stack has same logical id', () => {
    const sharedLogicalId = 'TestBucket560B80BC';

    const rootTemplate = {
      Resources: {
        [sharedLogicalId]: {
          Type: 'AWS::S3::Bucket',
          Metadata: { 'aws:cdk:path': 'TestStack/TestBucket/Resource' },
        },
        NestedStackResource: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: { TemplateURL: 'https://url' },
          Metadata: { 'aws:cdk:path': 'TestStack/TestNestedStack/Resource' },
        },
      },
    };

    let _template = rootTemplate;
    const mockArtifact = {
      get template() {
        return _template;
      },
      set _template(v: any) {
        _template = v;
      },
      templateFile: 'template.json',
      stackName: 'TestStack',
      findMetadataByType: () => [
        // Cloud assembly metadata includes entries from nested stacks too
        { path: '/TestStack/TestBucket/Resource', type: 'aws:cdk:logicalId', data: sharedLogicalId },
        { path: '/TestStack/TestNestedStack/TestBucket/Resource', type: 'aws:cdk:logicalId', data: sharedLogicalId },
      ],
    } as any;

    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockArtifact,
      },
    });
    const result = formatter.formatStackDiff();
    const sanitized = stripAnsi(result.formattedDiff!);

    // The parent stack diff should show the parent resource's path, not the nested stack's path
    expect(sanitized).toContain(`AWS::S3::Bucket TestBucket ${sharedLogicalId}`);
    expect(sanitized).not.toContain('TestNestedStack/TestBucket');
  });
});

describe('templateContainsNestedStacks', () => {
  test('returns true when template has AWS::CloudFormation::Stack resources', () => {
    expect(templateContainsNestedStacks({
      Resources: {
        Nested: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'https://url' } },
        Bucket: { Type: 'AWS::S3::Bucket' },
      },
    })).toBe(true);
  });

  test('returns false when template has no nested stacks', () => {
    expect(templateContainsNestedStacks({
      Resources: {
        Bucket: { Type: 'AWS::S3::Bucket' },
      },
    })).toBe(false);
  });

  test('returns false for empty template', () => {
    expect(templateContainsNestedStacks({})).toBe(false);
  });

  test('returns false for template with no Resources', () => {
    expect(templateContainsNestedStacks({ Parameters: {} })).toBe(false);
  });
});
