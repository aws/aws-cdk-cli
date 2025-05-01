import type { EndpointServiceAvailabilityZonesContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { IContextProviderMessages } from '.';
import { type SdkProvider } from '../api/aws-auth';
import type { ContextProviderPlugin } from '../api/plugin';
/**
 * Plugin to retrieve the Availability Zones for an endpoint service
 */
export declare class EndpointServiceAZContextProviderPlugin implements ContextProviderPlugin {
    private readonly aws;
    private readonly io;
    constructor(aws: SdkProvider, io: IContextProviderMessages);
    getValue(args: EndpointServiceAvailabilityZonesContextQuery): Promise<string[] | undefined>;
}
