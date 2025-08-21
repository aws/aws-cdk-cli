import { Bootstrapper } from '../../../lib/api/bootstrap';
import type { IIoHost } from '../../../lib/api/io';
import { asIoHelper } from '../../../lib/api/io/private';

describe('ExternalId Protection Integration Test', () => {
  let ioHost: IIoHost;
  let ioHelper: any;

  beforeEach(() => {
    ioHost = {
      notify: jest.fn(),
      requestResponse: jest.fn(),
    };
    ioHelper = asIoHelper(ioHost, 'bootstrap');
  });

  test('bootstrap template denies AssumeRole with ExternalId by default', async () => {
    // GIVEN
    const bootstrapper = new Bootstrapper({ source: 'default' }, ioHelper);

    // WHEN
    const template = await (bootstrapper as any).loadTemplate();

    // THEN
    // Verify the parameter exists
    expect(template.Parameters.DenyExternalId).toMatchObject({
      Type: 'String',
      Default: 'true',
      AllowedValues: ['true', 'false'],
    });

    // Verify the condition exists
    expect(template.Conditions.ShouldDenyExternalId).toEqual({
      'Fn::Equals': ['true', { Ref: 'DenyExternalId' }],
    });

    // Verify each role has the ExternalId condition
    const rolesToCheck = [
      'FilePublishingRole',
      'ImagePublishingRole',
      'LookupRole',
      'DeploymentActionRole',
    ];

    for (const roleName of rolesToCheck) {
      const role = template.Resources[roleName];
      expect(role).toBeDefined();

      // Find AssumeRole statements for AWS principals (not service principals)
      const assumeRoleStatements = role.Properties.AssumeRolePolicyDocument.Statement.filter(
        (stmt: any) => stmt.Action === 'sts:AssumeRole' && stmt.Principal?.AWS,
      );

      // Each AssumeRole statement should have the ExternalId condition
      for (const stmt of assumeRoleStatements) {
        expect(stmt.Condition).toEqual({
          'Fn::If': [
            'ShouldDenyExternalId',
            { Null: { 'sts:ExternalId': 'true' } },
            { Ref: 'AWS::NoValue' },
          ],
        });
      }
    }

    // Verify CloudFormationExecutionRole does NOT have the condition (it's assumed by service)
    const cfnRole = template.Resources.CloudFormationExecutionRole;
    const cfnStatements = cfnRole.Properties.AssumeRolePolicyDocument.Statement;
    for (const stmt of cfnStatements) {
      expect(stmt.Condition).toBeUndefined();
    }
  });
});
