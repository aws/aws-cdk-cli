import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk drift --verbose shows unchecked resources',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('define-vpc', { modEnv: { ENABLE_VPC_TESTING: 'DEFINE' } });

    // Assert that there's no drift when we deploy it, but there should be
    // unchecked resources, as there are some EC2 connection resources
    // (e.g. SubnetRouteTableAssociation) that do not support drift detection
    const drift = await fixture.cdk(['drift', '--verbose', fixture.fullStackName('define-vpc')], { modEnv: { ENABLE_VPC_TESTING: 'DEFINE' } });

    expect(drift).toMatch(/Stack.*define-vpc/); // cant just .toContain because of formatting
    expect(drift).toContain('No drift detected');
    expect(drift).toContain('(3 unchecked)'); // 2 SubnetRouteTableAssociations, 1 VPCGatewayAttachment
  }),
);
