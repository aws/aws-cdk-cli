import type * as cxapi from '@aws-cdk/cx-api';
import type { SdkProvider } from '../aws-auth';
import type { CloudFormationStack } from '../cloudformation';
import type { HotswapPropertyOverrides } from './common';
import type { SuccessfulDeployStackResult } from '../deployments';
import type { IoHelper } from '../io/private';
type HotswapMode = 'hotswap-only' | 'fall-back';
/**
 * Perform a hotswap deployment, short-circuiting CloudFormation if possible.
 * If it's not possible to short-circuit the deployment
 * (because the CDK Stack contains changes that cannot be deployed without CloudFormation),
 * returns `undefined`.
 */
export declare function tryHotswapDeployment(sdkProvider: SdkProvider, ioHelper: IoHelper, assetParams: {
    [key: string]: string;
}, cloudFormationStack: CloudFormationStack, stackArtifact: cxapi.CloudFormationStackArtifact, hotswapMode: HotswapMode, hotswapPropertyOverrides: HotswapPropertyOverrides): Promise<SuccessfulDeployStackResult | undefined>;
export {};
