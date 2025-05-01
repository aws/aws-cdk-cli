import type { AmiContextQuery } from '@aws-cdk/cloud-assembly-schema';
import type { IContextProviderMessages } from '.';
import { type SdkProvider } from '../api/aws-auth';
import type { ContextProviderPlugin } from '../api/plugin';
/**
 * Plugin to search AMIs for the current account
 */
export declare class AmiContextProviderPlugin implements ContextProviderPlugin {
    private readonly aws;
    private readonly io;
    constructor(aws: SdkProvider, io: IContextProviderMessages);
    getValue(args: AmiContextQuery): Promise<string>;
}
