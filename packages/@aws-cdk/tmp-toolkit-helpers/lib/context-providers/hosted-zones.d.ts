import type { HostedZoneContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { IContextProviderMessages } from '.';
import type { SdkProvider } from '../api/aws-auth';
import type { ContextProviderPlugin } from '../api/plugin';
export declare class HostedZoneContextProviderPlugin implements ContextProviderPlugin {
    private readonly aws;
    private readonly io;
    constructor(aws: SdkProvider, io: IContextProviderMessages);
    getValue(args: HostedZoneContextQuery): Promise<object>;
    private filterZones;
    private isHostedZoneQuery;
}
