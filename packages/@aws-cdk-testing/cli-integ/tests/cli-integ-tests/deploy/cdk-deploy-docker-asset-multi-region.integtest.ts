import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy same docker asset to multiple regions',
  withDefaultFixture(async (fixture) => {
    const primaryRegion = fixture.aws.region;
    const availableRegions = (process.env.AWS_REGIONS ?? 'us-east-1,us-west-2').split(',');
    const secondaryRegion = availableRegions.find((r) => r !== primaryRegion) ?? 'us-west-2';

    // Bootstrap the secondary region
    const account = await fixture.aws.account();
    await fixture.cdk(['bootstrap', '--bootstrap-kms-key-id', 'AWS_MANAGED_KEY', `aws://${account}/${secondaryRegion}`], {
      modEnv: { CDK_NEW_BOOTSTRAP: '1' },
    });

    // Deploy both stacks — same docker source, different target regions
    await fixture.cdkDeploy(['docker-multi-region-1', 'docker-multi-region-2'], {
      modEnv: { CDK_SECONDARY_REGION: secondaryRegion },
    });
  }),
);
