import type { StackSelector } from '../../api/cloud-assembly';

export interface ValidateOptions {
  /**
   * Select the stacks to validate
   */
  readonly stacks?: StackSelector;
}

/**
 * Whether validation passed or failed
 */
export type ValidationStatus = 'success' | 'failure';

/**
 * A resource that violated a validation rule
 */
export interface ViolatingResource {
  /**
   * The logical ID of the resource in the CloudFormation template
   */
  readonly resourceLogicalId: string;

  /**
   * The path to the CloudFormation template containing this resource
   */
  readonly templatePath: string;

  /**
   * Locations within the resource where the violation was detected
   */
  readonly locations?: string[];
}

/**
 * A construct that violated a validation rule
 */
export interface ViolatingConstruct {
  /**
   * The construct path
   */
  readonly constructPath?: string;

  /**
   * The construct stack trace
   */
  readonly constructStack?: string[];

  /**
   * Locations within the construct where the violation was detected
   */
  readonly locations?: string[];

  /**
   * The logical ID of the resource in the CloudFormation template
   */
  readonly resourceLogicalId: string;

  /**
   * The path to the CloudFormation template containing this resource
   */
  readonly templatePath: string;
}

/**
 * A single policy violation found by a validation plugin
 */
export interface ValidationViolation {
  /**
   * The name of the rule that was violated
   */
  readonly ruleName: string;

  /**
   * A description of the violation
   */
  readonly description: string;

  /**
   * How to fix the violation
   */
  readonly fix?: string;

  /**
   * Additional metadata about the rule
   */
  readonly ruleMetadata?: Record<string, string>;

  /**
   * The severity of the violation
   */
  readonly severity?: string;

  /**
   * Resources that violated the rule
   */
  readonly violatingResources: ViolatingResource[];

  /**
   * Constructs that violated the rule
   */
  readonly violatingConstructs: ViolatingConstruct[];
}

/**
 * Summary of a plugin's validation run
 */
export interface PluginReportSummary {
  /**
   * Name of the validation plugin
   */
  readonly pluginName: string;

  /**
   * Whether the plugin's validation passed or failed
   */
  readonly status: ValidationStatus;

  /**
   * Optional metadata from the plugin
   */
  readonly metadata?: Record<string, string>;
}

/**
 * Report from a single validation plugin
 */
export interface PluginValidationReport {
  /**
   * Version of the plugin
   */
  readonly version?: string;

  /**
   * Summary of the plugin's validation run
   */
  readonly summary: PluginReportSummary;

  /**
   * Policy violations found by this plugin
   */
  readonly violations: ValidationViolation[];
}

/**
 * The result of the validate action
 */
export interface ValidateResult {
  /**
   * Whether validation passed or failed overall.
   * 'success' if no plugins reported failures (or no plugins ran).
   * 'failure' if any plugin reported a failure.
   */
  readonly status: ValidationStatus;

  /**
   * The title of the validation report
   */
  readonly title?: string;

  /**
   * Reports from each validation plugin
   */
  readonly pluginReports: PluginValidationReport[];
}
