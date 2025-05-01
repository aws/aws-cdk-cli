import type { HotswapChange } from './common';
import type { ResourceChange } from '../../payloads/hotswap';
import type { EvaluateCloudFormationTemplate } from '../cloudformation';
export declare function isHotswappableS3BucketDeploymentChange(logicalId: string, change: ResourceChange, evaluateCfnTemplate: EvaluateCloudFormationTemplate): Promise<HotswapChange[]>;
export declare function skipChangeForS3DeployCustomResourcePolicy(iamPolicyLogicalId: string, change: ResourceChange, evaluateCfnTemplate: EvaluateCloudFormationTemplate): Promise<boolean>;
