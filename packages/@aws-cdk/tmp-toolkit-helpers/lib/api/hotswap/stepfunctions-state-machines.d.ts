import { type HotswapChange } from './common';
import type { ResourceChange } from '../../payloads/hotswap';
import type { EvaluateCloudFormationTemplate } from '../cloudformation';
export declare function isHotswappableStateMachineChange(logicalId: string, change: ResourceChange, evaluateCfnTemplate: EvaluateCloudFormationTemplate): Promise<HotswapChange[]>;
