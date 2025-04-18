import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk diff --security-only successfully outputs sso-permission-set-with-managed-policy information',
  withDefaultFixture(async (fixture) => {
    const diff = await fixture.cdk([
      'diff',
      '--security-only',
      fixture.fullStackName('sso-perm-set-with-managed-policy'),
    ]);
    `┌───┬──────────────────────────────────────────┬──────────────────────────────────┬────────────────────┬───────────────────────────────────────────────────────────────┬─────────────────────────────────┐
   │   │ Resource                                 │ InstanceArn                      │ PermissionSet name │ PermissionsBoundary                                           │ CustomerManagedPolicyReferences │
   ├───┼──────────────────────────────────────────┼──────────────────────────────────┼────────────────────┼───────────────────────────────────────────────────────────────┼─────────────────────────────────┤
   │ + │\${permission-set-with-managed-policy}    │ arn:aws:sso:::instance/testvalue │ niceWork           │ ManagedPolicyArn: arn:aws:iam::aws:policy/AdministratorAccess │ Name: forSSO, Path:             │
`;

    expect(diff).toContain('Resource');
    expect(diff).toContain('permission-set-with-managed-policy');

    expect(diff).toContain('InstanceArn');
    expect(diff).toContain('arn:aws:sso:::instance/testvalue');

    expect(diff).toContain('PermissionSet name');
    expect(diff).toContain('niceWork');

    expect(diff).toContain('PermissionsBoundary');
    expect(diff).toContain('ManagedPolicyArn: arn:aws:iam::aws:policy/AdministratorAccess');

    expect(diff).toContain('CustomerManagedPolicyReferences');
    expect(diff).toContain('Name: forSSO, Path:');
  }),
);

