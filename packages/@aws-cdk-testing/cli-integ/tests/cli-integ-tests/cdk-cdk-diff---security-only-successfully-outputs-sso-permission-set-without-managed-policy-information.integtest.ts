import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk diff --security-only successfully outputs sso-permission-set-without-managed-policy information',
  withDefaultFixture(async (fixture) => {
    const diff = await fixture.cdk([
      'diff',
      '--security-only',
      fixture.fullStackName('sso-perm-set-without-managed-policy'),
    ]);
    `┌───┬──────────────────────────────────────────┬──────────────────────────────────┬────────────────────┬───────────────────────────────────┬─────────────────────────────────┐
   │   │ Resource                                 │ InstanceArn                      │ PermissionSet name │ PermissionsBoundary               │ CustomerManagedPolicyReferences │
   ├───┼──────────────────────────────────────────┼──────────────────────────────────┼────────────────────┼───────────────────────────────────┼─────────────────────────────────┤
   │ + │\${permission-set-without-managed-policy} │ arn:aws:sso:::instance/testvalue │ testName           │ CustomerManagedPolicyReference: { │                                 │
   │   │                                          │                                  │                    │   Name: why, Path: /how/          │                                 │
   │   │                                          │                                  │                    │ }                                 │                                 │
`;
    expect(diff).toContain('Resource');
    expect(diff).toContain('permission-set-without-managed-policy');

    expect(diff).toContain('InstanceArn');
    expect(diff).toContain('arn:aws:sso:::instance/testvalue');

    expect(diff).toContain('PermissionSet name');
    expect(diff).toContain('testName');

    expect(diff).toContain('PermissionsBoundary');
    expect(diff).toContain('CustomerManagedPolicyReference: {');
    expect(diff).toContain('Name: why, Path: /how/');
    expect(diff).toContain('}');

    expect(diff).toContain('CustomerManagedPolicyReferences');
  }),
);

