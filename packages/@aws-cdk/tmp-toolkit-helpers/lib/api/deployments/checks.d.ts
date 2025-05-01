import type { SDK } from '../aws-auth';
import { type IoHelper } from '../io/private';
export declare function determineAllowCrossAccountAssetPublishing(sdk: SDK, ioHelper: IoHelper, customStackName?: string): Promise<boolean>;
interface BootstrapStackInfo {
    hasStagingBucket: boolean;
    bootstrapVersion: number;
}
export declare function getBootstrapStackInfo(sdk: SDK, stackName: string): Promise<BootstrapStackInfo>;
export {};
