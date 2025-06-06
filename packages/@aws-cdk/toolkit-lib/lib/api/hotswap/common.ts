import type { PropertyDifference } from '@aws-cdk/cloudformation-diff';
import type { HotswapProperties, EcsHotswapProperties as IEcsHotswapProperties } from '../../actions';
import type { HotswappableChange, NonHotswappableChange, ResourceChange } from '../../payloads/hotswap';
import { NonHotswappableReason } from '../../payloads/hotswap';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { SDK } from '../aws-auth/private';

export const ICON = '✨';

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
   * @defaultValue true
   */
  readonly hotswapOnlyVisible?: boolean;
}

export type HotswapChange = HotswapOperation | RejectedChange;

export enum HotswapMode {
  /**
   * Will fall back to CloudFormation when a non-hotswappable change is detected
   */
  FALL_BACK = 'fall-back',

  /**
   * Will not fall back to CloudFormation when a non-hotswappable change is detected
   */
  HOTSWAP_ONLY = 'hotswap-only',

  /**
   * Will not attempt to hotswap anything and instead go straight to CloudFormation
   */
  FULL_DEPLOYMENT = 'full-deployment',
}

/**
 * Represents configuration property overrides for hotswap deployments
 */
export class HotswapPropertyOverrides implements HotswapProperties {
  // Each supported resource type will have its own properties. Currently this is ECS
  readonly ecs?: IEcsHotswapProperties;

  public constructor (ecs?: IEcsHotswapProperties) {
    this.ecs = ecs;
  }
}

/**
 * Represents configuration properties for ECS hotswap deployments
 */
export class EcsHotswapProperties implements IEcsHotswapProperties {
  // The lower limit on the number of your service's tasks that must remain in the RUNNING state during a deployment, as a percentage of the desiredCount
  readonly minimumHealthyPercent?: number;
  // The upper limit on the number of your service's tasks that are allowed in the RUNNING or PENDING state during a deployment, as a percentage of the desiredCount
  readonly maximumHealthyPercent?: number;
  // The number of seconds to wait for a single service to reach stable state.
  readonly stabilizationTimeoutSeconds?: number;

  public constructor (minimumHealthyPercent?: number, maximumHealthyPercent?: number, stabilizationTimeoutSeconds?: number) {
    if (minimumHealthyPercent !== undefined && minimumHealthyPercent < 0 ) {
      throw new ToolkitError('hotswap-ecs-minimum-healthy-percent can\'t be a negative number');
    }
    if (maximumHealthyPercent !== undefined && maximumHealthyPercent < 0 ) {
      throw new ToolkitError('hotswap-ecs-maximum-healthy-percent can\'t be a negative number');
    }
    if (stabilizationTimeoutSeconds !== undefined && stabilizationTimeoutSeconds < 0 ) {
      throw new ToolkitError('hotswap-ecs-stabilization-timeout-seconds can\'t be a negative number');
    }
    // In order to preserve the current behaviour, when minimumHealthyPercent is not defined, it will be set to the currently default value of 0
    if (minimumHealthyPercent == undefined) {
      this.minimumHealthyPercent = 0;
    } else {
      this.minimumHealthyPercent = minimumHealthyPercent;
    }
    this.maximumHealthyPercent = maximumHealthyPercent;
    this.stabilizationTimeoutSeconds = stabilizationTimeoutSeconds;
  }

  /**
   * Check if any hotswap properties are defined
   * @returns true if all properties are undefined, false otherwise
   */
  public isEmpty(): boolean {
    return this.minimumHealthyPercent === 0 && this.maximumHealthyPercent === undefined;
  }
}

/**
 * Create the HotswapPropertyOverrides class out of the Interface exposed to users
 */
export function createHotswapPropertyOverrides(props: HotswapProperties): HotswapPropertyOverrides {
  return new HotswapPropertyOverrides(new EcsHotswapProperties(
    props.ecs?.minimumHealthyPercent,
    props.ecs?.maximumHealthyPercent,
    props.ecs?.stabilizationTimeoutSeconds,
  ));
}

type PropDiffs = Record<string, PropertyDifference<any>>;

class ClassifiedChanges {
  public constructor(
    public readonly change: ResourceChange,
    public readonly hotswappableProps: PropDiffs,
    public readonly nonHotswappableProps: PropDiffs,
  ) {
  }

  public reportNonHotswappablePropertyChanges(ret: HotswapChange[]): void {
    const nonHotswappablePropNames = Object.keys(this.nonHotswappableProps);
    if (nonHotswappablePropNames.length > 0) {
      const tagOnlyChange = nonHotswappablePropNames.length === 1 && nonHotswappablePropNames[0] === 'Tags';
      const reason = tagOnlyChange ? NonHotswappableReason.TAGS : NonHotswappableReason.PROPERTIES;
      const description = tagOnlyChange ? 'Tags are not hotswappable' : `resource properties '${nonHotswappablePropNames}' are not hotswappable on this resource type`;

      ret.push(nonHotswappableChange(
        this.change,
        reason,
        description,
        this.nonHotswappableProps,
      ));
    }
  }

  public get namesOfHotswappableProps(): string[] {
    return Object.keys(this.hotswappableProps);
  }
}

export function classifyChanges(xs: ResourceChange, hotswappablePropNames: string[]): ClassifiedChanges {
  const hotswappableProps: PropDiffs = {};
  const nonHotswappableProps: PropDiffs = {};

  for (const [name, propDiff] of Object.entries(xs.propertyUpdates)) {
    if (hotswappablePropNames.includes(name)) {
      hotswappableProps[name] = propDiff;
    } else {
      nonHotswappableProps[name] = propDiff;
    }
  }

  return new ClassifiedChanges(xs, hotswappableProps, nonHotswappableProps);
}

export function nonHotswappableChange(
  change: ResourceChange,
  reason: NonHotswappableReason,
  description: string,
  nonHotswappableProps?: PropDiffs,
  hotswapOnlyVisible: boolean = true,
): RejectedChange {
  return {
    hotswappable: false,
    hotswapOnlyVisible,
    change: {
      reason,
      description,
      subject: {
        type: 'Resource',
        logicalId: change.logicalId,
        resourceType: change.newValue.Type,
        rejectedProperties: Object.keys(nonHotswappableProps ?? change.propertyUpdates),
        metadata: change.metadata,
      },
    },
  };
}

export function nonHotswappableResource(change: ResourceChange): RejectedChange {
  return {
    hotswappable: false,
    change: {
      reason: NonHotswappableReason.RESOURCE_UNSUPPORTED,
      description: 'This resource type is not supported for hotswap deployments',
      subject: {
        type: 'Resource',
        logicalId: change.logicalId,
        resourceType: change.newValue.Type,
        rejectedProperties: Object.keys(change.propertyUpdates),
        metadata: change.metadata,
      },
    },
  };
}
