import { ProxyAgent } from 'proxy-agent';
import type { SdkHttpOptions } from './sdk-provider';
import { type IoHelper } from '../io/private';
export declare class ProxyAgentProvider {
    private readonly ioHelper;
    constructor(ioHelper: IoHelper);
    create(options: SdkHttpOptions): Promise<ProxyAgent>;
    private tryGetCACert;
    /**
     * Find and return a CA certificate bundle path to be passed into the SDK.
     */
    private caBundlePathFromEnvironment;
}
