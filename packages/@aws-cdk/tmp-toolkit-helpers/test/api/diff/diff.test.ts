import type * as cxapi from '@aws-cdk/cx-api';
import * as chalk from 'chalk';
import { DiffFormatter } from '../../../src/api/diff/diff-formatter';
import { IoHelper, IoDefaultMessages } from '../../../src/api/io/private';
import { RequireApproval } from '../../../src/api/require-approval';

jest.mock('../../../src/api/io/private/messages', () => ({
  IoDefaultMessages: jest.fn(),
}));

describe('formatStackDiff', () => {
  let mockIoHelper: IoHelper;
  let mockNewTemplate: cxapi.CloudFormationStackArtifact;
  let mockIoDefaultMessages: any;

  beforeEach(() => {
    const mockNotify = jest.fn().mockResolvedValue(undefined);
    const mockRequestResponse = jest.fn().mockResolvedValue(undefined);

    mockIoHelper = IoHelper.fromIoHost(
      { notify: mockNotify, requestResponse: mockRequestResponse },
      'diff',
    );

    mockIoDefaultMessages = {
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
    };

    jest.spyOn(mockIoHelper, 'notify').mockImplementation(() => Promise.resolve());
    jest.spyOn(mockIoHelper, 'requestResponse').mockImplementation(() => Promise.resolve());

    (IoDefaultMessages as jest.Mock).mockImplementation(() => mockIoDefaultMessages);

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
      ioHelper: mockIoHelper,
      templateInfo: {
        oldTemplate: mockNewTemplate.template,
        newTemplate: mockNewTemplate,
        stackName: 'test-stack',
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
      ioHelper: mockIoHelper,
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        stackName: 'test-stack',
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
      ioHelper: mockIoHelper,
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        stackName: 'test-stack',
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
      ioHelper: mockIoHelper,
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        stackName: 'test-stack',
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
  let mockIoHelper: IoHelper;
  let mockNewTemplate: cxapi.CloudFormationStackArtifact;
  let mockIoDefaultMessages: any;

  beforeEach(() => {
    const mockNotify = jest.fn().mockResolvedValue(undefined);
    const mockRequestResponse = jest.fn().mockResolvedValue(undefined);

    mockIoHelper = IoHelper.fromIoHost(
      { notify: mockNotify, requestResponse: mockRequestResponse },
      'diff',
    );

    mockIoDefaultMessages = {
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
    };

    jest.spyOn(mockIoHelper, 'notify').mockImplementation(() => Promise.resolve());
    jest.spyOn(mockIoHelper, 'requestResponse').mockImplementation(() => Promise.resolve());

    // Mock IoDefaultMessages constructor to return our mock instance
    (IoDefaultMessages as jest.Mock).mockImplementation(() => mockIoDefaultMessages);

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

  test('returns empty object when no security changes exist', () => {
    // WHEN
    const formatter = new DiffFormatter({
      ioHelper: mockIoHelper,
      templateInfo: {
        oldTemplate: mockNewTemplate.template,
        newTemplate: mockNewTemplate,
        stackName: 'test-stack',
      },
    });
    const result = formatter.formatSecurityDiff({
      requireApproval: RequireApproval.BROADENING,
    });

    // THEN
    expect(result.formattedDiff).toBeUndefined();
    expect(mockIoDefaultMessages.warning).not.toHaveBeenCalled();
  });

  test('formats diff when permissions are broadened and approval level is BROADENING', () => {
    // WHEN
    const formatter = new DiffFormatter({
      ioHelper: mockIoHelper,
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        stackName: 'test-stack',
      },
    });
    const result = formatter.formatSecurityDiff({
      requireApproval: RequireApproval.BROADENING,
    });

    // THEN
    expect(result.formattedDiff).toBeDefined();
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

  test('formats diff for any security change when approval level is ANY_CHANGE', () => {
    // WHEN
    const formatter = new DiffFormatter({
      ioHelper: mockIoHelper,
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        stackName: 'test-stack',
      },
    });
    const result = formatter.formatSecurityDiff({
      requireApproval: RequireApproval.ANY_CHANGE,
    });

    // THEN
    expect(result.formattedDiff).toBeDefined();
    expect(mockIoDefaultMessages.warning).toHaveBeenCalledWith(
      expect.stringContaining('potentially sensitive changes'),
    );
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

  test('returns empty object when approval level is NEVER', () => {
    // WHEN
    const formatter = new DiffFormatter({
      ioHelper: mockIoHelper,
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        stackName: 'test-stack',
      },
    });
    const result = formatter.formatSecurityDiff({
      requireApproval: RequireApproval.NEVER,
    });

    // THEN
    expect(result.formattedDiff).toBeUndefined();
    expect(mockIoDefaultMessages.warning).not.toHaveBeenCalled();
  });
});
