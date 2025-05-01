import type { KeyContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { KeyContextResponse } from '@aws-cdk/cx-api';
import type { IContextProviderMessages } from '.';
import type { SdkProvider } from '../api/aws-auth';
import type { ContextProviderPlugin } from '../api/plugin';
export declare class KeyContextProviderPlugin implements ContextProviderPlugin {
    private readonly aws;
    private readonly io;
    constructor(aws: SdkProvider, io: IContextProviderMessages);
    getValue(args: KeyContextQuery): Promise<KeyContextResponse>;
    private findKey;
    private readKeyProps;
}
