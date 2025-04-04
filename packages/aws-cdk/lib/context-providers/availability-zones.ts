import type { AvailabilityZonesContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { AvailabilityZone } from '@aws-sdk/client-ec2';
import type { IContextProviderMessages } from '.';
import { type SdkProvider, initContextProviderSdk } from '../api/aws-auth';
import type { ContextProviderPlugin } from '../api/plugin';

/**
 * Plugin to retrieve the Availability Zones for the current account
 */
export class AZContextProviderPlugin implements ContextProviderPlugin {
  constructor(private readonly aws: SdkProvider, private readonly io: IContextProviderMessages) {
  }

  public async getValue(args: AvailabilityZonesContextQuery) {
    const region = args.region;
    const account = args.account;
    await this.io.debug(`Reading AZs for ${account}:${region}`);
    const ec2 = (await initContextProviderSdk(this.aws, args)).ec2();
    const response = await ec2.describeAvailabilityZones({});
    if (!response.AvailabilityZones) {
      return [];
    }
    const azs = response.AvailabilityZones.filter((zone: AvailabilityZone) => zone.State === 'available').map(
      (zone: AvailabilityZone) => zone.ZoneName,
    );
    return azs;
  }
}
