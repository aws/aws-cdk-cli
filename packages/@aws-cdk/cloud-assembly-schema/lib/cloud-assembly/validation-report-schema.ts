/**
 * JSON schema for policy-validation-report.json
 *
 * This file is written to the cloud assembly directory by aws-cdk-lib
 * during synthesis and consumed by the CDK CLI's validate command.
 */

/**
 * The top-level structure of the policy validation report file.
 */
export interface PolicyValidationReportJson {
  /**
   * Report title.
   */
  readonly title: string;

  /**
   * Reports from all validation plugins that ran during synthesis.
   */
  readonly pluginReports: PluginReportJson[];
}

/**
 * A report from a single validation plugin.
 */
export interface PluginReportJson {
  /**
   * Version of the plugin that produced this report.
   *
   * @default - no version
   */
  readonly version?: string;

  /**
   * Summary of the plugin's validation run.
   */
  readonly summary: PolicyValidationReportSummary;

  /**
   * Violations found by this plugin.
   */
  readonly violations: PolicyViolationJson[];
}

/**
 * Summary of a plugin's validation run.
 */
export interface PolicyValidationReportSummary {
  /**
   * The name of the plugin that produced this report.
   */
  readonly pluginName: string;

  /**
   * Whether the plugin's validation passed or failed.
   */
  readonly status: PolicyValidationReportStatus;

  /**
   * Additional plugin-specific metadata.
   *
   * @default - no metadata
   */
  readonly metadata?: { readonly [key: string]: string };
}

/**
 * The final status of a validation report.
 */
export type PolicyValidationReportStatus = 'success' | 'failure';

/**
 * A single policy violation found by a validation plugin.
 */
export interface PolicyViolationJson {
  /**
   * The name of the rule that was violated.
   */
  readonly ruleName: string;

  /**
   * A description of the violation.
   */
  readonly description: string;

  /**
   * How to fix the violation.
   *
   * @default - no fix provided
   */
  readonly fix?: string;

  /**
   * The severity of the violation.
   *
   * @default - no severity
   */
  readonly severity?: string;

  /**
   * Additional rule-specific metadata.
   *
   * @default - no metadata
   */
  readonly ruleMetadata?: { readonly [key: string]: string };

  /**
   * Resources that violated the rule.
   */
  readonly violatingResources: ViolatingResourceJson[];

  /**
   * Constructs that violated the rule.
   */
  readonly violatingConstructs: ViolatingConstructJson[];
}

/**
 * A resource that violated a policy rule.
 */
export interface ViolatingResourceJson {
  /**
   * The logical ID of the resource in the CloudFormation template.
   */
  readonly resourceLogicalId: string;

  /**
   * The path to the CloudFormation template containing this resource.
   */
  readonly templatePath: string;

  /**
   * Locations within the template that pose violations.
   *
   * @default - no locations
   */
  readonly locations?: string[];
}

/**
 * A construct that violated a policy rule.
 */
export interface ViolatingConstructJson {
  /**
   * The construct path as defined in the application.
   *
   * @default - no construct path
   */
  readonly constructPath?: string;

  /**
   * The construct creation stack trace.
   *
   * @default - no stack trace
   */
  readonly constructStack?: ConstructTraceJson;

  /**
   * Locations within the construct where the violation was detected.
   *
   * @default - no locations
   */
  readonly locations?: string[];

  /**
   * The logical ID of the resource in the CloudFormation template.
   */
  readonly resourceLogicalId: string;

  /**
   * The path to the CloudFormation template containing this resource.
   */
  readonly templatePath: string;
}

/**
 * A node in the construct creation stack trace.
 */
export interface ConstructTraceJson {
  /**
   * The construct ID.
   */
  readonly id: string;

  /**
   * The construct path.
   */
  readonly path: string;

  /**
   * The child node in the trace (towards the leaf).
   *
   * @default - this is the leaf node
   */
  readonly child?: ConstructTraceJson;

  /**
   * The fully qualified name of the construct class.
   *
   * @default - no construct info
   */
  readonly construct?: string;

  /**
   * The version of the library that contains this construct.
   *
   * @default - no version info
   */
  readonly libraryVersion?: string;

  /**
   * The source code location where this construct was created.
   *
   * @default - no location info
   */
  readonly location?: string;
}
