/* eslint-disable import/order */

import * as deployStack from '../../../lib/api/deployments/deploy-stack';
import type { Stack } from '@aws-sdk/client-cloudformation';
import { CreatePolicyCommand, GetPolicyCommand } from '@aws-sdk/client-iam';
import { Match, Template } from 'aws-cdk-lib/assertions';

import {
  mockBootstrapStack,
  mockIAMClient,
  MockSdkProvider,
  restoreSdkMocksToDefault, setDefaultSTSMocks,
} from '../../_helpers/mock-sdk';
import { asIoHelper } from '../../../lib/api/io/private';
import type { IIoHost } from '../../../lib/api/io';
import { Bootstrapper } from '../../../lib/api/bootstrap';
import { ToolkitInfo } from '../../../lib/api/toolkit-info';

const mockDeployStack = jest.spyOn(deployStack, 'deployStack');

let bootstrapper: Bootstrapper;
let stderrMock: jest.SpyInstance;
let ioHost: IIoHost = {
  notify: jest.fn().mockImplementation((msg) => {
    process.stderr.write(msg.message + '\n');
  }),
  requestResponse: jest.fn().mockImplementation((msg) => {
    process.stderr.write(msg.message + '\n');
    return msg.defaultResponses;
  }),
};
let ioHelper = asIoHelper(ioHost, 'bootstrap');

beforeEach(() => {
  jest.mocked(ioHost.notify).mockClear();
  jest.mocked(ioHost.requestResponse).mockClear();
  bootstrapper = new Bootstrapper({ source: 'default' }, ioHelper);
  stderrMock = jest.spyOn(process.stderr, 'write').mockImplementation(() => {
    return true;
  });
});

afterEach(() => {
  stderrMock.mockRestore();
});

function mockTheToolkitInfo(stackProps: Partial<Stack>) {
  (ToolkitInfo as any).lookup = jest.fn().mockResolvedValue(ToolkitInfo.fromStack(mockBootstrapStack(stackProps)));
}

describe('Bootstrapping v2', () => {
  const env = {
    account: '123456789012',
    region: 'us-east-1',
    name: 'mock',
  };

  let sdk: MockSdkProvider;
  beforeEach(() => {
    sdk = new MockSdkProvider();
    // By default, we'll return a non-found toolkit info
    (ToolkitInfo as any).lookup = jest.fn().mockResolvedValue(ToolkitInfo.bootstrapStackNotFoundInfo('BootstrapStack'));
    const value = {
      Policy: {
        PolicyName: 'my-policy',
        Arn: 'arn:aws:iam::0123456789012:policy/my-policy',
      },
    };
    restoreSdkMocksToDefault();
    setDefaultSTSMocks();
    mockIAMClient.on(GetPolicyCommand).resolves(value);
    mockIAMClient.on(CreatePolicyCommand).resolves(value);
    mockDeployStack.mockResolvedValue({
      type: 'did-deploy-stack',
      noOp: false,
      outputs: {},
      stackArn: 'arn:stack',
    });
  });

  afterEach(() => {
    mockDeployStack.mockClear();
  });

  test('passes the bucket name as a CFN parameter', async () => {
    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        bucketName: 'my-bucket-name',
        cloudFormationExecutionPolicies: ['arn:policy'],
      },
    });

    expect(mockDeployStack).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          FileAssetsBucketName: 'my-bucket-name',
          PublicAccessBlockConfiguration: 'true',
        }),
      }),
      expect.anything(),
    );
  });

  test('passes the KMS key ID as a CFN parameter', async () => {
    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        cloudFormationExecutionPolicies: ['arn:policy'],
        kmsKeyId: 'my-kms-key-id',
      },
    });

    expect(mockDeployStack).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          FileAssetsBucketKmsKeyId: 'my-kms-key-id',
          PublicAccessBlockConfiguration: 'true',
        }),
      }),
      expect.anything(),
    );
  });

  test('passes false to PublicAccessBlockConfiguration', async () => {
    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        cloudFormationExecutionPolicies: ['arn:policy'],
        publicAccessBlockConfiguration: false,
      },
    });

    expect(mockDeployStack).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          PublicAccessBlockConfiguration: 'false',
        }),
      }),
      expect.anything(),
    );
  });

  test('passes true to PermissionsBoundary', async () => {
    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        examplePermissionsBoundary: true,
      },
    });

    expect(mockDeployStack).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          InputPermissionsBoundary: 'cdk-hnb659fds-permissions-boundary',
        }),
      }),
      expect.anything(),
    );
  });

  test('passes value to PermissionsBoundary', async () => {
    mockTheToolkitInfo({
      Parameters: [
        {
          ParameterKey: 'InputPermissionsBoundary',
          ParameterValue: 'existing-pb',
        },
      ],
    });
    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        customPermissionsBoundary: 'permissions-boundary-name',
      },
    });

    expect(mockDeployStack).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          InputPermissionsBoundary: 'permissions-boundary-name',
        }),
      }),
      expect.anything(),
    );
    expect(stderrMock.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.stringMatching(/Changing permissions boundary from existing-pb to permissions-boundary-name/),
        ]),
      ]),
    );
  });

  test('permission boundary switch message does not appear', async () => {
    mockTheToolkitInfo({
      Parameters: [
        {
          ParameterKey: 'InputPermissionsBoundary',
          ParameterValue: '',
        },
      ],
    });
    await bootstrapper.bootstrapEnvironment(env, sdk);

    expect(stderrMock.mock.calls).toEqual(
      expect.arrayContaining([expect.not.arrayContaining([expect.stringMatching(/Changing permissions boundary/)])]),
    );
  });

  test('adding new permissions boundary', async () => {
    mockTheToolkitInfo({
      Parameters: [
        {
          ParameterKey: 'InputPermissionsBoundary',
          ParameterValue: '',
        },
      ],
    });
    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        customPermissionsBoundary: 'permissions-boundary-name',
      },
    });

    expect(stderrMock.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([expect.stringMatching(/Adding new permissions boundary permissions-boundary-name/)]),
      ]),
    );
  });

  test('removing existing permissions boundary', async () => {
    mockTheToolkitInfo({
      Parameters: [
        {
          ParameterKey: 'InputPermissionsBoundary',
          ParameterValue: 'permissions-boundary-name',
        },
      ],
    });
    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {},
    });

    expect(stderrMock.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.stringMatching(/Removing existing permissions boundary permissions-boundary-name/),
        ]),
      ]),
    );
  });

  test('adding permission boundary with path in policy name', async () => {
    mockTheToolkitInfo({
      Parameters: [
        {
          ParameterKey: 'InputPermissionsBoundary',
          ParameterValue: '',
        },
      ],
    });
    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        customPermissionsBoundary: 'permissions-boundary-name/with/path',
      },
    });

    expect(stderrMock.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.stringMatching(/Adding new permissions boundary permissions-boundary-name\/with\/path/),
        ]),
      ]),
    );
  });

  test('passing trusted accounts without CFN managed policies results in an error', async () => {
    await expect(
      bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {
          trustedAccounts: ['123456789012'],
        },
      }),
    ).rejects.toThrow(/--cloudformation-execution-policies/);
  });

  test('passing trusted accounts without CFN managed policies on the existing stack results in an error', async () => {
    mockTheToolkitInfo({
      Parameters: [
        {
          ParameterKey: 'CloudFormationExecutionPolicies',
          ParameterValue: '',
        },
      ],
    });

    await expect(
      bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {
          trustedAccounts: ['123456789012'],
        },
      }),
    ).rejects.toThrow(/--cloudformation-execution-policies/);
  });

  test('passing no CFN managed policies without trusted accounts is okay', async () => {
    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {},
    });

    expect(mockDeployStack).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          CloudFormationExecutionPolicies: '',
        }),
      }),
      expect.anything(),
    );
  });

  test('passing trusted accounts for lookup generates the correct stack parameter', async () => {
    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        trustedAccountsForLookup: ['123456789012'],
        cloudFormationExecutionPolicies: ['aws://foo'],
      },
    });

    expect(mockDeployStack).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          TrustedAccountsForLookup: '123456789012',
        }),
      }),
      expect.anything(),
    );
  });

  test('allow adding trusted account if there was already a policy on the stack', async () => {
    // GIVEN
    mockTheToolkitInfo({
      Parameters: [
        {
          ParameterKey: 'CloudFormationExecutionPolicies',
          ParameterValue: 'arn:aws:something',
        },
      ],
    });

    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        trustedAccounts: ['123456789012'],
      },
    });
    // Did not throw
  });

  test('removes trusted account when it is listed as untrusted', async () => {
    // GIVEN
    mockTheToolkitInfo({
      Parameters: [
        {
          ParameterKey: 'CloudFormationExecutionPolicies',
          ParameterValue: 'arn:aws:something',
        },
        {
          ParameterKey: 'TrustedAccounts',
          ParameterValue: '111111111111,222222222222',
        },
      ],
    });

    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        untrustedAccounts: ['111111111111'],
      },
    });

    expect(mockDeployStack).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          TrustedAccounts: '222222222222',
        }),
      }),
      expect.anything(),
    );
  });

  test('removes trusted account for lookup when it is listed as untrusted', async () => {
    // GIVEN
    mockTheToolkitInfo({
      Parameters: [
        {
          ParameterKey: 'CloudFormationExecutionPolicies',
          ParameterValue: 'arn:aws:something',
        },
        {
          ParameterKey: 'TrustedAccountsForLookup',
          ParameterValue: '111111111111,222222222222',
        },
      ],
    });

    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        untrustedAccounts: ['111111111111'],
      },
    });

    expect(mockDeployStack).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          TrustedAccountsForLookup: '222222222222',
        }),
      }),
      expect.anything(),
    );
  });

  test('do not allow accounts to be listed as both trusted and untrusted', async () => {
    await expect(bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        trustedAccountsForLookup: ['123456789012'],
        untrustedAccounts: ['123456789012'],
      },
    })).rejects.toThrow('Accounts cannot be both trusted and untrusted. Found: 123456789012');
  });

  test('Do not allow downgrading bootstrap stack version', async () => {
    // GIVEN
    mockTheToolkitInfo({
      Outputs: [
        {
          OutputKey: 'BootstrapVersion',
          OutputValue: '999',
        },
      ],
    });

    await expect(
      bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {
          cloudFormationExecutionPolicies: ['arn:policy'],
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ noOp: true }));
  });

  test('Do not allow overwriting bootstrap stack from a different vendor', async () => {
    // GIVEN
    mockTheToolkitInfo({
      Parameters: [
        {
          ParameterKey: 'BootstrapVariant',
          ParameterValue: 'JoeSchmoe',
        },
      ],
    });

    await expect(bootstrapper.bootstrapEnvironment(env, sdk, {})).resolves.toEqual(
      expect.objectContaining({ noOp: true }),
    );
  });

  test('bootstrap template has the right exports', async () => {
    let template: any;
    mockDeployStack.mockImplementation((args: deployStack.DeployStackOptions) => {
      template = args.stack.template;
      return Promise.resolve({
        type: 'did-deploy-stack',
        noOp: false,
        outputs: {},
        stackArn: 'arn:stack',
      });
    });

    await bootstrapper.bootstrapEnvironment(env, sdk, {
      parameters: {
        cloudFormationExecutionPolicies: ['arn:policy'],
      },
    });

    const exports = Object.values(template.Outputs ?? {})
      .filter((o: any) => o.Export !== undefined)
      .map((o: any) => o.Export.Name);

    expect(exports).toEqual([
      // This used to be used by aws-s3-assets
      { 'Fn::Sub': 'CdkBootstrap-${Qualifier}-FileAssetKeyArn' },
    ]);
  });

  describe('termination protection', () => {
    test('stack is not termination protected by default', async () => {
      await bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {
          cloudFormationExecutionPolicies: ['arn:policy'],
        },
      });

      expect(mockDeployStack).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: expect.objectContaining({
            terminationProtection: false,
          }),
        }),
        expect.anything(),
      );
    });

    test('stack is termination protected when option is set', async () => {
      await bootstrapper.bootstrapEnvironment(env, sdk, {
        terminationProtection: true,
        parameters: {
          cloudFormationExecutionPolicies: ['arn:policy'],
        },
      });

      expect(mockDeployStack).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: expect.objectContaining({
            terminationProtection: true,
          }),
        }),
        expect.anything(),
      );
    });

    test('termination protection is left alone when option is not given', async () => {
      mockTheToolkitInfo({
        EnableTerminationProtection: true,
      });

      await bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {
          cloudFormationExecutionPolicies: ['arn:policy'],
        },
      });

      expect(mockDeployStack).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: expect.objectContaining({
            terminationProtection: true,
          }),
        }),
        expect.anything(),
      );
    });

    test('termination protection can be switched off', async () => {
      mockTheToolkitInfo({
        EnableTerminationProtection: true,
      });

      await bootstrapper.bootstrapEnvironment(env, sdk, {
        terminationProtection: false,
        parameters: {
          cloudFormationExecutionPolicies: ['arn:policy'],
        },
      });

      expect(mockDeployStack).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: expect.objectContaining({
            terminationProtection: false,
          }),
        }),
        expect.anything(),
      );
    });
  });

  describe('KMS key', () => {
    test.each([
      // Default case
      [undefined, 'AWS_MANAGED_KEY'],
      // Create a new key
      [true, ''],
      // Don't create a new key
      [false, 'AWS_MANAGED_KEY'],
    ])(
      '(new stack) createCustomerMasterKey=%p => parameter becomes %p ',
      async (createCustomerMasterKey, paramKeyId) => {
        // GIVEN: no existing stack

        // WHEN
        await bootstrapper.bootstrapEnvironment(env, sdk, {
          parameters: {
            createCustomerMasterKey,
            cloudFormationExecutionPolicies: ['arn:booh'],
          },
        });

        // THEN
        expect(mockDeployStack).toHaveBeenCalledWith(
          expect.objectContaining({
            parameters: expect.objectContaining({
              FileAssetsBucketKmsKeyId: paramKeyId,
            }),
          }),
          expect.anything(),
        );
      },
    );

    test.each([
      // Old bootstrap stack being upgraded to new one
      [undefined, undefined, 'AWS_MANAGED_KEY'],
      // There is a value, user doesn't request a change
      ['arn:aws:key', undefined, undefined],
      // Switch off existing key
      ['arn:aws:key', false, 'AWS_MANAGED_KEY'],
      // Switch on existing key
      ['AWS_MANAGED_KEY', true, ''],
    ])(
      '(upgrading) current param %p, createCustomerMasterKey=%p => parameter becomes %p ',
      async (currentKeyId, createCustomerMasterKey, paramKeyId) => {
        // GIVEN
        mockTheToolkitInfo({
          Parameters: currentKeyId
            ? [
              {
                ParameterKey: 'FileAssetsBucketKmsKeyId',
                ParameterValue: currentKeyId,
              },
            ]
            : undefined,
        });

        // WHEN
        await bootstrapper.bootstrapEnvironment(env, sdk, {
          parameters: {
            createCustomerMasterKey,
            cloudFormationExecutionPolicies: ['arn:booh'],
          },
        });

        // THEN
        expect(mockDeployStack).toHaveBeenCalledWith(
          expect.objectContaining({
            parameters: expect.objectContaining({
              FileAssetsBucketKmsKeyId: paramKeyId,
            }),
          }),
          expect.anything(),
        );
      },
    );
  });

  describe('ExternalId protection', () => {
    test('denyExternalId parameter is not present by default', async () => {
      // GIVEN
      const mockSdk = new MockSdkProvider();
      (ToolkitInfo as any).lookup = jest.fn().mockResolvedValue(ToolkitInfo.fromStack(mockBootstrapStack({
        Outputs: [
          { OutputKey: 'BootstrapVersion', OutputValue: '1' },
        ],
      })));

      // WHEN
      await bootstrapper.bootstrapEnvironment(env, mockSdk, {
        parameters: {},
      });

      // THEN
      expect(mockDeployStack).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.not.objectContaining({
            DenyExternalId: 'true',
          }),
        }),
        expect.anything(),
      );
    });

    test.each([false, true])('denyExternalId parameter can be set to %p', async (param) => {
      // GIVEN
      const mockSdk2 = new MockSdkProvider();
      (ToolkitInfo as any).lookup = jest.fn().mockResolvedValue(ToolkitInfo.fromStack(mockBootstrapStack({
        Outputs: [
          { OutputKey: 'BootstrapVersion', OutputValue: '1' },
        ],
      })));

      // WHEN
      await bootstrapper.bootstrapEnvironment(env, mockSdk2, {
        parameters: {
          denyExternalId: param,
        },
      });

      // THEN
      expect(mockDeployStack).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({
            DenyExternalId: `${param}`,
          }),
        }),
        expect.anything(),
      );
    });

    test('bootstrap template contains ExternalId conditions', async () => {
      // GIVEN
      const testBootstrapper = new Bootstrapper({ source: 'default' }, ioHelper);

      // WHEN
      const template = await (testBootstrapper as any).loadTemplate();

      // THEN
      expect(template.Parameters.DenyExternalId).toBeDefined();
      expect(template.Parameters.DenyExternalId.Default).toBe('true');
      expect(template.Conditions.ShouldDenyExternalId).toBeDefined();

      // Check that roles have the ExternalId condition
      const filePublishingRole = template.Resources.FilePublishingRole;
      expect(filePublishingRole.Properties.AssumeRolePolicyDocument.Statement).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Action: 'sts:AssumeRole',
            Condition: expect.objectContaining({
              'Fn::If': expect.arrayContaining(['ShouldDenyExternalId']),
            }),
          }),
        ]),
      );
    });
  });

  describe('contains sts:TagSession on trusted accounts', () => {
    let template: Template;

    const iamRoleName = (name: string) => {
      return {
        'Fn::Sub': `cdk-\${Qualifier}-${name}-\${AWS::AccountId}-\${AWS::Region}`,
      };
    };

    const statementWithCondition = (conditionName: string) => {
      return Match.objectLike({
        'Fn::If': Match.arrayWith([
          conditionName,
          Match.objectLike({
            Action: Match.arrayWith(['sts:TagSession']),
          }),
        ]),
      });
    };

    beforeEach(async () => {
      let rawTemplate: any;
      mockDeployStack.mockImplementation((args: deployStack.DeployStackOptions) => {
        rawTemplate = args.stack.template;
        return Promise.resolve({
          type: 'did-deploy-stack',
          noOp: false,
          outputs: {},
          stackArn: 'arn:stack',
        });
      });
      await bootstrapper.bootstrapEnvironment(env, sdk, {});
      template = Template.fromJSON(rawTemplate);
    });

    test.each([
      ['FilePublishingRole', 'file-publishing-role'],
      ['ImagePublishingRole', 'image-publishing-role'],
      ['DeploymentActionRole', 'deploy-role'],
    ])('in the %p', async (_, roleName) => {
      template.hasResource('AWS::IAM::Role', {
        Properties: {
          RoleName: iamRoleName(roleName),
          AssumeRolePolicyDocument: {
            Statement: Match.arrayWith([
              statementWithCondition('HasTrustedAccounts'),
            ]),
          },
        },
      });
    });

    test('in the LookupRole', async () => {
      template.hasResource('AWS::IAM::Role', {
        Properties: {
          RoleName: iamRoleName('lookup-role'),
          AssumeRolePolicyDocument: {
            Statement: Match.arrayWith([
              statementWithCondition('HasTrustedAccountsForLookup'),
              statementWithCondition('HasTrustedAccounts'),
            ]),
          },
        },
      });
    });
  });

  describe('PermissionsBoundaryAllRoles', () => {
    test('passes PermissionsBoundaryAllRoles parameter as true when flag is set', async () => {
      await bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {
          customPermissionsBoundary: 'my-boundary',
          permissionsBoundaryAllRoles: true,
        },
      });

      expect(mockDeployStack).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({
            PermissionsBoundaryAllRoles: 'true',
          }),
        }),
        expect.anything(),
      );
    });

    test('passes PermissionsBoundaryAllRoles parameter as false when flag is not set', async () => {
      await bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {
          customPermissionsBoundary: 'my-boundary',
        },
      });

      expect(mockDeployStack).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({
            PermissionsBoundaryAllRoles: 'false',
          }),
        }),
        expect.anything(),
      );
    });

    test('passes PermissionsBoundaryAllRoles parameter as false by default', async () => {
      await bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {},
      });

      expect(mockDeployStack).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({
            PermissionsBoundaryAllRoles: 'false',
          }),
        }),
        expect.anything(),
      );
    });

    test('shows warning when permissionsBoundaryAllRoles is used without permissions boundary', async () => {
      await bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {
          permissionsBoundaryAllRoles: true,
        },
      });

      expect(stderrMock.mock.calls).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(/--permissions-boundary-all-roles has no effect without --custom-permissions-boundary or --example-permissions-boundary/),
          ]),
        ]),
      );
    });

    test('no warning when permissionsBoundaryAllRoles is used with customPermissionsBoundary', async () => {
      await bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {
          customPermissionsBoundary: 'my-boundary',
          permissionsBoundaryAllRoles: true,
        },
      });

      expect(stderrMock.mock.calls).not.toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(/--permissions-boundary-all-roles has no effect/),
          ]),
        ]),
      );
    });

    test('no warning when permissionsBoundaryAllRoles is used with examplePermissionsBoundary', async () => {
      await bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {
          examplePermissionsBoundary: true,
          permissionsBoundaryAllRoles: true,
        },
      });

      expect(stderrMock.mock.calls).not.toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(/--permissions-boundary-all-roles has no effect/),
          ]),
        ]),
      );
    });

    test('no warning when permissionsBoundaryAllRoles is false without permissions boundary', async () => {
      await bootstrapper.bootstrapEnvironment(env, sdk, {
        parameters: {
          permissionsBoundaryAllRoles: false,
        },
      });

      expect(stderrMock.mock.calls).not.toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.stringMatching(/--permissions-boundary-all-roles has no effect/),
          ]),
        ]),
      );
    });

    test('bootstrap template contains PermissionsBoundaryAllRoles parameter', async () => {
      const testBootstrapper = new Bootstrapper({ source: 'default' }, ioHelper);
      const template = await (testBootstrapper as any).loadTemplate();

      expect(template.Parameters.PermissionsBoundaryAllRoles).toBeDefined();
      expect(template.Parameters.PermissionsBoundaryAllRoles.Default).toBe('false');
      expect(template.Parameters.PermissionsBoundaryAllRoles.AllowedValues).toEqual(['true', 'false']);
    });

    test('bootstrap template contains ApplyPermissionsBoundaryToAllRoles condition', async () => {
      const testBootstrapper = new Bootstrapper({ source: 'default' }, ioHelper);
      const template = await (testBootstrapper as any).loadTemplate();

      expect(template.Conditions.ApplyPermissionsBoundaryToAllRoles).toBeDefined();
    });

    test('bootstrap template has PermissionsBoundary on additional roles with condition', async () => {
      const testBootstrapper = new Bootstrapper({ source: 'default' }, ioHelper);
      const template = await (testBootstrapper as any).loadTemplate();

      // FilePublishingRole, ImagePublishingRole, LookupRole, and DeploymentActionRole
      // should have conditional PermissionsBoundary
      const rolesToCheck = ['FilePublishingRole', 'ImagePublishingRole', 'LookupRole', 'DeploymentActionRole'];
      for (const roleName of rolesToCheck) {
        const role = template.Resources[roleName];
        expect(role.Properties.PermissionsBoundary).toBeDefined();
        expect(role.Properties.PermissionsBoundary['Fn::If'][0]).toBe('ApplyPermissionsBoundaryToAllRoles');
      }
    });

    test('CloudFormationExecutionRole always uses PermissionsBoundarySet condition', async () => {
      const testBootstrapper = new Bootstrapper({ source: 'default' }, ioHelper);
      const template = await (testBootstrapper as any).loadTemplate();

      const cfnRole = template.Resources.CloudFormationExecutionRole;
      expect(cfnRole.Properties.PermissionsBoundary).toBeDefined();
      // CloudFormationExecutionRole uses PermissionsBoundarySet condition, not ApplyPermissionsBoundaryToAllRoles
      expect(cfnRole.Properties.PermissionsBoundary['Fn::If'][0]).toBe('PermissionsBoundarySet');
    });
  });
});
