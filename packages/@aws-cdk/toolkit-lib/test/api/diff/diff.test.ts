import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import * as chalk from 'chalk';
import { DiffFormatter } from '../../../lib/api/diff/diff-formatter';

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

  test('handles nested stack templates', () => {
    // GIVEN
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

    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        nestedStacks,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(3);
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('test-stack')}`);
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('nested-stack-1')}`);
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('nested-stack-2')}`);
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

