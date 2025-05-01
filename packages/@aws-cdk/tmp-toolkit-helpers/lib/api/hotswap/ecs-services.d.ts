import type { HotswapPropertyOverrides, HotswapChange } from './common';
import { type ResourceChange } from '../../payloads/hotswap';
import type { EvaluateCloudFormationTemplate } from '../cloudformation';
export declare function isHotswappableEcsServiceChange(logicalId: string, change: ResourceChange, evaluateCfnTemplate: EvaluateCloudFormationTemplate, hotswapPropertyOverrides: HotswapPropertyOverrides): Promise<HotswapChange[]>;
