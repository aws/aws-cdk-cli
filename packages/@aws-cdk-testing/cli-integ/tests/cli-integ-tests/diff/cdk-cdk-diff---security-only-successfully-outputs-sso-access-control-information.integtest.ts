import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk diff --security-only successfully outputs sso-access-control information',
  withDefaultFixture(async (fixture) => {
    const diff = await fixture.cdk(['diff', '--security-only', fixture.fullStackName('sso-access-control')]);
    `┌───┬────────────────────────────────┬────────────────────────┬─────────────────────────────────┐
   │   │ Resource                       │ InstanceArn            │ AccessControlAttributes         │
   ├───┼────────────────────────────────┼────────────────────────┼─────────────────────────────────┤
   │ + │\${instanceAccessControlConfig} │ arn:aws:test:testvalue │ Key: first, Values: [a]         │
   │   │                                │                        │ Key: second, Values: [b]        │
   │   │                                │                        │ Key: third, Values: [c]         │
   │   │                                │                        │ Key: fourth, Values: [d]        │
   │   │                                │                        │ Key: fifth, Values: [e]         │
   │   │                                │                        │ Key: sixth, Values: [f]         │
   └───┴────────────────────────────────┴────────────────────────┴─────────────────────────────────┘
`;
    expect(diff).toContain('Resource');
    expect(diff).toContain('instanceAccessControlConfig');

    expect(diff).toContain('InstanceArn');
    expect(diff).toContain('arn:aws:sso:::instance/testvalue');

    expect(diff).toContain('AccessControlAttributes');
    expect(diff).toContain('Key: first, Values: [a]');
    expect(diff).toContain('Key: second, Values: [b]');
    expect(diff).toContain('Key: third, Values: [c]');
    expect(diff).toContain('Key: fourth, Values: [d]');
    expect(diff).toContain('Key: fifth, Values: [e]');
    expect(diff).toContain('Key: sixth, Values: [f]');
  }),
);

