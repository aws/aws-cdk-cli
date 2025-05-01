import type { PropertyDifference } from '@aws-cdk/cloudformation-diff';
import type { HotswappableChange, NonHotswappableChange, ResourceChange } from '../../payloads/hotswap';
import { NonHotswappableReason } from '../../payloads/hotswap';
import type { SDK } from '../aws-auth';
export declare const ICON = "\u2728";
export interface HotswapOperation {
    /**
     * Marks the operation as hotswappable
     */
    readonly hotswappable: true;
    /**
     * The name of the service being hotswapped.
     * Used to set a custom User-Agent for SDK calls.
     */
    readonly service: string;
    /**
     * Description of the change that is applied as part of the operation
     */
    readonly change: HotswappableChange;
    /**
     * Applies the hotswap operation
     */
    readonly apply: (sdk: SDK) => Promise<void>;
}
export interface RejectedChange {
    /**
     * Marks the change as not hotswappable
     */
    readonly hotswappable: false;
    /**
     * The change that got rejected
     */
    readonly change: NonHotswappableChange;
    /**
     * Whether or not to show this change when listing non-hotswappable changes in HOTSWAP_ONLY mode. Does not affect
     * listing in FALL_BACK mode.
     *
     * @default true
     */
    readonly hotswapOnlyVisible?: boolean;
}
export type HotswapChange = HotswapOperation | RejectedChange;
export declare enum HotswapMode {
    /**
     * Will fall back to CloudFormation when a non-hotswappable change is detected
     */
    FALL_BACK = "fall-back",
    /**
     * Will not fall back to CloudFormation when a non-hotswappable change is detected
     */
    HOTSWAP_ONLY = "hotswap-only",
    /**
     * Will not attempt to hotswap anything and instead go straight to CloudFormation
     */
    FULL_DEPLOYMENT = "full-deployment"
}
/**
 * Represents configuration property overrides for hotswap deployments
 */
export declare class HotswapPropertyOverrides {
    ecsHotswapProperties?: EcsHotswapProperties;
    constructor(ecsHotswapProperties?: EcsHotswapProperties);
}
/**
 * Represents configuration properties for ECS hotswap deployments
 */
export declare class EcsHotswapProperties {
    readonly minimumHealthyPercent?: number;
    readonly maximumHealthyPercent?: number;
    constructor(minimumHealthyPercent?: number, maximumHealthyPercent?: number);
    /**
     * Check if any hotswap properties are defined
     * @returns true if all properties are undefined, false otherwise
     */
    isEmpty(): boolean;
}
type PropDiffs = Record<string, PropertyDifference<any>>;
declare class ClassifiedChanges {
    readonly change: ResourceChange;
    readonly hotswappableProps: PropDiffs;
    readonly nonHotswappableProps: PropDiffs;
    constructor(change: ResourceChange, hotswappableProps: PropDiffs, nonHotswappableProps: PropDiffs);
    reportNonHotswappablePropertyChanges(ret: HotswapChange[]): void;
    get namesOfHotswappableProps(): string[];
}
export declare function classifyChanges(xs: ResourceChange, hotswappablePropNames: string[]): ClassifiedChanges;
export declare function nonHotswappableChange(change: ResourceChange, reason: NonHotswappableReason, description: string, nonHotswappableProps?: PropDiffs, hotswapOnlyVisible?: boolean): RejectedChange;
export declare function nonHotswappableResource(change: ResourceChange): RejectedChange;
export {};
