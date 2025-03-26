import type { EndpointServiceAvailabilityZonesContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { IContextProviderMessages } from '.';
import { type SdkProvider, initContextProviderSdk } from '../api/aws-auth/sdk-provider';
import type { ContextProviderPlugin } from '../api/plugin';

/**
 * Plugin to retrieve the Availability Zones for an endpoint service
 */
export class EndpointServiceAZContextProviderPlugin implements ContextProviderPlugin {
  constructor(private readonly aws: SdkProvider, private readonly io: IContextProviderMessages) {
  }

  public async getValue(args: EndpointServiceAvailabilityZonesContextQuery) {
    const region = args.region;
    const account = args.account;
    const serviceName = args.serviceName;
    await this.io.debug(`Reading AZs for ${account}:${region}:${serviceName}`);
    const ec2 = (await initContextProviderSdk(this.aws, args)).ec2();
    const response = await ec2.describeVpcEndpointServices({
      ServiceNames: [serviceName],
    });

    // expect a service in the response
    if (!response.ServiceDetails || response.ServiceDetails.length === 0) {
      await this.io.debug(`Could not retrieve service details for ${account}:${region}:${serviceName}`);
      return [];
    }
    const azs = response.ServiceDetails[0].AvailabilityZones;
    await this.io.debug(`Endpoint service ${account}:${region}:${serviceName} is available in availability zones ${azs}`);
    return azs;
  }
}
