import type { PropertyDifference } from '@aws-cdk/cloudformation-diff';
import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import type { HotswappableChange, ResourceChange } from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api/io/payloads/hotswap';
import { NonHotswappableReason } from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api/io/payloads/hotswap';
import { ToolkitError } from '../../toolkit/error';
import type { SDK } from '../aws-auth';

export const ICON = '✨';

/**
 * The result of an attempted hotswap deployment
 */
export interface HotswapResult {
  /**
   * The stack that was hotswapped
   */
  readonly stack: CloudFormationStackArtifact;
  /**
   * Whether hotswapping happened or not.
   *
   * `false` indicates that the deployment could not be hotswapped and full deployment may be attempted as fallback.
   */
  readonly hotswapped: boolean;
  /**
   * The changes that were deemed hotswappable
   */
  readonly hotswappableChanges: HotswappableChange[];
  /**
   * The changes that were deemed not hotswappable
   */
  readonly nonHotswappableChanges: any[];
}

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
   * The friendly type of the rejected change
   */
  readonly resourceType: string;
  /**
   * The list of properties that are cause for the rejection
   */
  readonly rejectedProperties?: Array<string>;
  /**
   * The logical ID of the resource that is not hotswappable
   */
  readonly logicalId: string;
  /**
   * Why was this change was deemed non-hotswappable
   */
  readonly reason: NonHotswappableReason;
  /**
   * Tells the user exactly why this change was deemed non-hotswappable and what its logical ID is.
   * If not specified, `displayReason` default to state that the properties listed in `rejectedChanges` are not hotswappable.
   */
  readonly description: string;
  /**
   * Whether or not to show this change when listing non-hotswappable changes in HOTSWAP_ONLY mode. Does not affect
   * listing in FALL_BACK mode.
   *
   * @default true
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
export class HotswapPropertyOverrides {
  // Each supported resource type will have its own properties. Currently this is ECS
  ecsHotswapProperties?: EcsHotswapProperties;

  public constructor (ecsHotswapProperties?: EcsHotswapProperties) {
    this.ecsHotswapProperties = ecsHotswapProperties;
  }
}

/**
 * Represents configuration properties for ECS hotswap deployments
 */
export class EcsHotswapProperties {
  // The lower limit on the number of your service's tasks that must remain in the RUNNING state during a deployment, as a percentage of the desiredCount
  readonly minimumHealthyPercent?: number;
  // The upper limit on the number of your service's tasks that are allowed in the RUNNING or PENDING state during a deployment, as a percentage of the desiredCount
  readonly maximumHealthyPercent?: number;

  public constructor (minimumHealthyPercent?: number, maximumHealthyPercent?: number) {
    if (minimumHealthyPercent !== undefined && minimumHealthyPercent < 0 ) {
      throw new ToolkitError('hotswap-ecs-minimum-healthy-percent can\'t be a negative number');
    }
    if (maximumHealthyPercent !== undefined && maximumHealthyPercent < 0 ) {
      throw new ToolkitError('hotswap-ecs-maximum-healthy-percent can\'t be a negative number');
    }
    // In order to preserve the current behaviour, when minimumHealthyPercent is not defined, it will be set to the currently default value of 0
    if (minimumHealthyPercent == undefined) {
      this.minimumHealthyPercent = 0;
    } else {
      this.minimumHealthyPercent = minimumHealthyPercent;
    }
    this.maximumHealthyPercent = maximumHealthyPercent;
  }

  /**
   * Check if any hotswap properties are defined
   * @returns true if all properties are undefined, false otherwise
   */
  public isEmpty(): boolean {
    return this.minimumHealthyPercent === 0 && this.maximumHealthyPercent === undefined;
  }
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
    rejectedProperties: Object.keys(nonHotswappableProps ?? change.propertyUpdates),
    logicalId: change.logicalId,
    resourceType: change.newValue.Type,
    reason,
    description,
    hotswapOnlyVisible,
  };
}

export function nonHotswappableResource(change: ResourceChange): RejectedChange {
  return {
    hotswappable: false,
    rejectedProperties: Object.keys(change.propertyUpdates),
    logicalId: change.logicalId,
    resourceType: change.newValue.Type,
    reason: NonHotswappableReason.RESOURCE_UNSUPPORTED,
    description: 'This resource type is not supported for hotswap deployments',
  };
}
