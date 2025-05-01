import type { VpcContextQuery } from '@aws-cdk/cloud-assembly-schema';
import { type VpcContextResponse } from '@aws-cdk/cx-api';
import type { IContextProviderMessages } from '.';
import type { SdkProvider } from '../api/aws-auth';
import type { ContextProviderPlugin } from '../api/plugin';
export declare class VpcNetworkContextProviderPlugin implements ContextProviderPlugin {
    private readonly aws;
    private readonly io;
    constructor(aws: SdkProvider, io: IContextProviderMessages);
    getValue(args: VpcContextQuery): Promise<VpcContextResponse>;
    private findVpc;
    private readVpcProps;
}
