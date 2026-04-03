import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --security-only successfully outputs sso-assignment information',
  withDefaultFixture(async (fixture) => {
    const diff = await fixture.cdk(['diff', '--security-only', fixture.fullStackName('sso-assignment')]);
    `┌───┬───────────────┬──────────────────────────────────┬─────────────────────────┬──────────────────────────────┬───────────────┬──────────────┬─────────────┐
   │   │ Resource      │ InstanceArn                      │ PermissionSetArn        │ PrincipalId                  │ PrincipalType │ TargetId     │ TargetType  │
   ├───┼───────────────┼──────────────────────────────────┼─────────────────────────┼──────────────────────────────┼───────────────┼──────────────┼─────────────┤
   │ + │\${assignment} │ arn:aws:sso:::instance/testvalue │ arn:aws:sso:::testvalue │ 11111111-2222-3333-4444-test │ USER          │ 111111111111 │ AWS_ACCOUNT │
   └───┴───────────────┴──────────────────────────────────┴─────────────────────────┴──────────────────────────────┴───────────────┴──────────────┴─────────────┘
`;
    expect(diff).toContain('Resource');
    expect(diff).toContain('assignment');

    expect(diff).toContain('InstanceArn');
    expect(diff).toContain('arn:aws:sso:::instance/testvalue');

    expect(diff).toContain('PermissionSetArn');
    expect(diff).toContain('arn:aws:sso:::testvalue');

    expect(diff).toContain('PrincipalId');
    expect(diff).toContain('11111111-2222-3333-4444-test');

    expect(diff).toContain('PrincipalType');
    expect(diff).toContain('USER');

    expect(diff).toContain('TargetId');
    expect(diff).toContain('111111111111');

    expect(diff).toContain('TargetType');
    expect(diff).toContain('AWS_ACCOUNT');
  }),
);

