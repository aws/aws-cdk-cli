import { fullDiff, formatSecurityChanges, formatDifferences, mangleLikeCloudFormation } from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import * as chalk from 'chalk';
import { formatSecurityDiff, formatStackDiff } from '../../../src/api/diff/diff';
import { IoHelper, IoDefaultMessages } from '../../../src/api/io/private';
import { RequireApproval } from '../../../src/api/require-approval';

jest.mock('@aws-cdk/cloudformation-diff', () => ({
  fullDiff: jest.fn(),
  formatSecurityChanges: jest.fn(),
  formatDifferences: jest.fn(),
  mangleLikeCloudFormation: jest.fn(),
}));

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
      template: {},
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    (fullDiff as jest.Mock).mockReset();
    (formatDifferences as jest.Mock).mockImplementation((stream) => {
      stream.write('Changes detected');
    });
    (mangleLikeCloudFormation as jest.Mock).mockImplementation((input) => {
      return input;
    });
  });

  test('returns no changes when templates are identical', () => {
    // GIVEN
    const mockDiff = { isEmpty: true };
    (fullDiff as jest.Mock).mockReturnValue(mockDiff);

    // WHEN
    const result = formatStackDiff(
      mockIoHelper,
      {},
      mockNewTemplate,
      false,
      3,
      false,
      'test-stack',
    );

    // THEN
    expect(result.numStacksWithChanges).toBe(0);
    expect(result.formattedDiff).toBe('');
    expect(mockIoDefaultMessages.info).toHaveBeenCalledWith(expect.stringContaining('no differences'));
  });

  test('formats differences when changes exist', () => {
    // GIVEN
    const mockDiff = { isEmpty: false, differenceCount: 1 };
    (fullDiff as jest.Mock).mockReturnValue(mockDiff);

    // WHEN
    const result = formatStackDiff(
      mockIoHelper,
      {},
      mockNewTemplate,
      false,
      3,
      false,
      'test-stack',
    );

    // THEN
    expect(result.numStacksWithChanges).toBe(1);
    expect(result.formattedDiff).toContain('Changes detected');
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('test-stack')}`);
  });

  test('handles nested stack templates', () => {
    // GIVEN
    const mockDiff = { isEmpty: false, differenceCount: 1 };
    (fullDiff as jest.Mock).mockReturnValue(mockDiff);
    const nestedStackTemplates = {
      NestedStack1: {
        deployedTemplate: {},
        generatedTemplate: {},
        physicalName: 'nested-stack-1',
        nestedStackTemplates: {},
      },
    };

    // WHEN
    const result = formatStackDiff(
      mockIoHelper,
      {},
      mockNewTemplate,
      false,
      3,
      false,
      'test-stack',
      undefined,
      false,
      nestedStackTemplates,
    );

    // THEN
    expect(result.numStacksWithChanges).toBe(2);
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('test-stack')}`);
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('nested-stack-1')}`);
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
      template: {},
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    (fullDiff as jest.Mock).mockReset();
    (formatSecurityChanges as jest.Mock).mockReset();
  });

  test('returns empty object when no security changes exist', () => {
    // GIVEN
    const mockDiff = {
      permissionsAnyChanges: false,
      permissionsBroadened: false,
    };
    (fullDiff as jest.Mock).mockReturnValue(mockDiff);

    // WHEN
    const result = formatSecurityDiff(
      mockIoHelper,
      {},
      mockNewTemplate,
      RequireApproval.BROADENING,
      'test-stack',
    );

    // THEN
    expect(result).toEqual({});
    expect(mockIoDefaultMessages.warning).not.toHaveBeenCalled();
  });

  test('formats diff when permissions are broadened and approval level is BROADENING', () => {
    // GIVEN
    const mockDiff = {
      permissionsAnyChanges: true,
      permissionsBroadened: true,
    };
    (fullDiff as jest.Mock).mockReturnValue(mockDiff);
    (formatSecurityChanges as jest.Mock).mockImplementation((stream) => {
      stream.write('Security changes detected');
    });

    // WHEN
    const result = formatSecurityDiff(
      mockIoHelper,
      {},
      mockNewTemplate,
      RequireApproval.BROADENING,
      'test-stack',
    );

    // THEN
    expect(result.formattedDiff).toBeDefined();
    expect(result.formattedDiff).toContain('Security changes detected');
    expect(mockIoDefaultMessages.warning).toHaveBeenCalledWith(
      expect.stringContaining('potentially sensitive changes'),
    );
  });

  test('formats diff for any security change when approval level is ANY_CHANGE', () => {
    // GIVEN
    const mockDiff = {
      permissionsAnyChanges: true,
      permissionsBroadened: false,
    };
    (fullDiff as jest.Mock).mockReturnValue(mockDiff);
    (formatSecurityChanges as jest.Mock).mockImplementation((stream) => {
      stream.write('Minor security changes detected');
    });

    // WHEN
    const result = formatSecurityDiff(
      mockIoHelper,
      {},
      mockNewTemplate,
      RequireApproval.ANY_CHANGE,
      'test-stack',
    );

    // THEN
    expect(result.formattedDiff).toBeDefined();
    expect(result.formattedDiff).toContain('Minor security changes detected');
    expect(mockIoDefaultMessages.warning).toHaveBeenCalledWith(
      expect.stringContaining('potentially sensitive changes'),
    );
  });

  test('returns empty object when approval level is NEVER', () => {
    // GIVEN
    const mockDiff = {
      permissionsAnyChanges: true,
      permissionsBroadened: true,
    };
    (fullDiff as jest.Mock).mockReturnValue(mockDiff);

    // WHEN
    const result = formatSecurityDiff(
      mockIoHelper,
      {},
      mockNewTemplate,
      RequireApproval.NEVER,
      'test-stack',
    );

    // THEN
    expect(result).toEqual({});
    expect(mockIoDefaultMessages.warning).not.toHaveBeenCalled();
    expect(formatSecurityChanges).not.toHaveBeenCalled();
  });

  test('handles undefined stack name', () => {
    // GIVEN
    const mockDiff = {
      permissionsAnyChanges: true,
      permissionsBroadened: true,
    };
    (fullDiff as jest.Mock).mockReturnValue(mockDiff);
    (formatSecurityChanges as jest.Mock).mockImplementation((stream) => {
      stream.write('Security changes detected');
    });

    // WHEN
    const result = formatSecurityDiff(
      mockIoHelper,
      {},
      mockNewTemplate,
      RequireApproval.BROADENING,
    );

    // THEN
    expect(result.formattedDiff).toBeDefined();
    expect(mockIoDefaultMessages.info).toHaveBeenCalledWith(expect.stringContaining(`Stack ${chalk.bold('undefined')}`));
  });

  test('handles changeSet parameter', () => {
    // GIVEN
    const mockDiff = {
      permissionsAnyChanges: true,
      permissionsBroadened: true,
    };
    const mockChangeSet = {
      Changes: [],
    };
    (fullDiff as jest.Mock).mockReturnValue(mockDiff);

    // WHEN
    formatSecurityDiff(
      mockIoHelper,
      {},
      mockNewTemplate,
      RequireApproval.BROADENING,
      'test-stack',
      mockChangeSet,
    );

    // THEN
    expect(fullDiff).toHaveBeenCalledWith({}, expect.any(Object), mockChangeSet);
  });
});
