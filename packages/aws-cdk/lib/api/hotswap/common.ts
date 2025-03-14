import type { PropertyDifference } from '@aws-cdk/cloudformation-diff';
import { NonHotswappableReason, type HotswappableChange, type ResourceChange } from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api/io/payloads/hotswap';
import type { ResourceMetadata } from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api/resource-metadata/resource-metadata';
import { ToolkitError } from '../../toolkit/error';
import type { SDK } from '../aws-auth';

export const ICON = '✨';

export interface HotswapOperation {
  readonly hotswappable: true;

  /**
   * Description of the change that is applied as part of the operation
   */
  readonly change: HotswappableChange;

  /**
   * The name of the service being hotswapped.
   * Used to set a custom User-Agent for SDK calls.
   */
  readonly service: string;

  /**
   * Applies the hotswap operation
   */
  readonly apply: (sdk: SDK) => Promise<void>;
}

export type ChangeSubject =
  | { type: 'Output' }
  | {
    type: 'Resource';
    resourceType: string;
  };

export interface NonHotswappableChange {
  /**
   * The change is not hotswappable
   */
  readonly hotswappable: false;
  /**
   * The CloudFormation resource type of the resource
   */
  readonly subject: ChangeSubject;
  /**
   * A list of properties that caused the change to be not hotswappable
   *
   * If undefined or empty, the change is not hotswappable for a different reason and will be explained in `reason`
   */
  readonly rejectedChanges?: Array<string>;
  /**
   * The logical if of the resource
   */
  readonly logicalId: string;
  /**
   * Why was this change was deemed non-hotswappable
   */
  readonly reason: string;
  /**
   * Tells the user exactly why this change was deemed non-hotswappable and what its logical ID is.
   * If not specified, `displayReason` default to state that the properties listed in `rejectedChanges` are not hotswappable.
   */
  readonly displayReason?: string;
  /**
   * Resource metadata for the change from the cloud assembly
   *
   * This is only present if the resource is present in the current Cloud Assembly,
   * i.e. resource deletions will not have metadata.
   */
  readonly metadata?: ResourceMetadata;
  /**
   * Whether or not this not hotswappable change can be skipped in a hotswap deployment.
   *
   * If a change is not skippable, it forces a full deployment in FALL_BACK mode.
   *
   * @default true
   */
  readonly hotswapOnlyVisible?: boolean;
}

export type ChangeHotswapResult = Array<HotswapOperation | NonHotswappableChange>;

export interface ClassifiedResourceChanges {
  hotswappableChanges: HotswapOperation[];
  nonHotswappableChanges: NonHotswappableChange[];
}

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

type Exclude = { [key: string]: Exclude | true };

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

/**
 * This function transforms all keys (recursively) in the provided `val` object.
 *
 * @param val The object whose keys need to be transformed.
 * @param transform The function that will be applied to each key.
 * @param exclude The keys that will not be transformed and copied to output directly
 * @returns A new object with the same values as `val`, but with all keys transformed according to `transform`.
 */
export function transformObjectKeys(val: any, transform: (str: string) => string, exclude: Exclude = {}): any {
  if (val == null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    // For arrays we just pass parent's exclude object directly
    // since it makes no sense to specify different exclude options for each array element
    return val.map((input: any) => transformObjectKeys(input, transform, exclude));
  }
  const ret: { [k: string]: any } = {};
  for (const [k, v] of Object.entries(val)) {
    const childExclude = exclude[k];
    if (childExclude === true) {
      // we don't transform this object if the key is specified in exclude
      ret[transform(k)] = v;
    } else {
      ret[transform(k)] = transformObjectKeys(v, transform, childExclude);
    }
  }
  return ret;
}

/**
 * This function lower cases the first character of the string provided.
 */
export function lowerCaseFirstCharacter(str: string): string {
  return str.length > 0 ? `${str[0].toLowerCase()}${str.slice(1)}` : str;
}

type PropDiffs = Record<string, PropertyDifference<any>>;

export class ClassifiedChanges {
  public constructor(
    public readonly change: ResourceChange,
    public readonly hotswappableProps: PropDiffs,
    public readonly nonHotswappableProps: PropDiffs,
  ) {
  }

  public reportNonHotswappablePropertyChanges(ret: ChangeHotswapResult): void {
    const nonHotswappablePropNames = Object.keys(this.nonHotswappableProps);
    if (nonHotswappablePropNames.length > 0) {
      const tagOnlyChange = nonHotswappablePropNames.length === 1 && nonHotswappablePropNames[0] === 'Tags';
      const reason = tagOnlyChange ? NonHotswappableReason.TAGS : NonHotswappableReason.PROPERTIES;
      const displayReason = tagOnlyChange ? 'Tags are not hotswappable' : `resource properties '${nonHotswappablePropNames}' are not hotswappable on this resource type`;

      reportNonHotswappableChange(
        ret,
        this.change,
        reason,
        this.nonHotswappableProps,
        displayReason,
      );
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

export function reportNonHotswappableChange(
  ret: ChangeHotswapResult,
  change: ResourceChange,
  reason: NonHotswappableReason,
  nonHotswappableProps?: PropDiffs,
  displayReason?: string,
  hotswapOnlyVisible: boolean = true,
): void {
  ret.push({
    hotswappable: false,
    rejectedChanges: Object.keys(nonHotswappableProps ?? change.propertyUpdates),
    logicalId: change.logicalId,
    subject: change.newValue.Type as any,
    reason,
    displayReason,
    hotswapOnlyVisible,
  });
}

export function reportNonHotswappableResource(
  change: ResourceChange,
  reason: NonHotswappableReason,
  displayReason?: string,
): ChangeHotswapResult {
  return [
    {
      hotswappable: false,
      rejectedChanges: Object.keys(change.propertyUpdates),
      logicalId: change.logicalId,
      subject: change.newValue.Type as any,
      reason,
      displayReason,
    },
  ];
}
