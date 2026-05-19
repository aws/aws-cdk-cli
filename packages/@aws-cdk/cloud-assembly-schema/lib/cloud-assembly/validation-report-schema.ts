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
   * Report title, if present.
   */
  readonly title?: string;

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
   * The name of the plugin that produced this report.
   */
  readonly pluginName: string;

  /**
   * Version of the plugin that produced this report.
   *
   * @default - no version
   */
  readonly pluginVersionersion?: string;

  /**
   * Whether the plugin's validation passed or failed.
   */
  readonly conclusion: PolicyValidationReportConclusion;

  /**
   * Additional plugin-specific metadata.
   *
   * @default - no metadata
   */
  readonly metadata?: { readonly [key: string]: string };

  /**
   * Violations found by this plugin.
   */
  readonly violations: PolicyViolationJson[];
}

/**
 * The final conclusion of a validation report.
 */
export type PolicyValidationReportConclusion = 'success' | 'failure';

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
  readonly suggestedFix?: string;

  /**
   * The severity of the violation.
   */
  readonly severity: PolicyViolationSeverity;

  /**
   * If the plugin wants to report using a non-standard severity, put it here
   */
  readonly customSeverity?: string;

  /**
   * Additional rule-specific metadata.
   *
   * @default - no metadata
   */
  readonly ruleMetadata?: { readonly [key: string]: string };

  /**
   * Constructs that violated the rule.
   */
  readonly violatingConstructs: ViolatingConstructJson[];
}

/**
 * The severity of a policy violation.
 *
 * If you need to use a severity level that doesn't exist as a static member,
 * use `custom`.
 */
export type PolicyViolationSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'custom';

/**
 * A construct that violated a policy rule.
 */
export interface ViolatingConstructJson {
  /**
   * The construct path as defined in the application.
   *
   * @default - no construct path
   */
  readonly constructPath: string;

  /**
   * The fully qualified name of the construct class (includes the library name)
   *
   * @default - no construct info
   */
  readonly constructFqn?: string;

  /**
   * The version of the library that contains this construct.
   *
   * The library name is the first component of the construct FQN.
   *
   * @default - no version info
   */
  readonly libraryVersion?: string;

  /**
   * If this construct violation regards a CloudFormation resource, a reference to the resource details
   */
  readonly cloudFormationResource?: CloudFormationResourceJson;
}

/**
 * A node in the construct creation stack trace.
 */
export interface CloudFormationResourceJson {
  /**
   * The path to the CloudFormation template containing this resource.
   */
  readonly templatePath: string;

  /**
   * The logical ID of the resource in the CloudFormation template.
   */
  readonly logicalId: string;

  /**
   * Properties within the construct where the violation was detected.
   *
   * Either a single component, in which case it regards a top-level property
   * name, or a JSON path (starting with `$.`) to indicate a deeper property.
   *
   * @default - no locations
   */
  readonly propertyPaths?: string[];
}
