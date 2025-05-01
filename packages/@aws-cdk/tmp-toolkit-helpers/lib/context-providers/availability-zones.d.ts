import type { AvailabilityZonesContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { IContextProviderMessages } from '.';
import { type SdkProvider } from '../api/aws-auth';
import type { ContextProviderPlugin } from '../api/plugin';
/**
 * Plugin to retrieve the Availability Zones for the current account
 */
export declare class AZContextProviderPlugin implements ContextProviderPlugin {
    private readonly aws;
    private readonly io;
    constructor(aws: SdkProvider, io: IContextProviderMessages);
    getValue(args: AvailabilityZonesContextQuery): Promise<(string | undefined)[]>;
}
