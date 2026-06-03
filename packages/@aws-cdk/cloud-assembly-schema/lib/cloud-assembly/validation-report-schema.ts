/**
 * JSON schema for validation-report.json
 *
 * This file is written to the cloud assembly directory by aws-cdk-lib
 * during synthesis and consumed by the CDK CLI's validate command.
 */

/**
 * The top-level structure of the policy validation report file.
 *
 * @example
 * import { PolicyValidationReportJson } from '@aws-cdk/cloud-assembly-schema';
 *
 * const report: PolicyValidationReportJson = {
 *   version: '1.0',
 *   pluginReports: [{
 *     pluginName: 'my-plugin',
 *     conclusion: 'success',
 *     violations: [],
 *   }],
 * };
 */
export interface PolicyValidationReportJson {
  /**
   * Protocol version
   */
  readonly version: string;

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
 *
 * @example
 * import { PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
 *
 * const report: PluginReportJson = {
 *   pluginName: 'my-plugin',
 *   conclusion: 'success',
 *   violations: [],
 * };
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
  readonly pluginVersion?: string;

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

  /**
   * Violations that were suppressed via acknowledgement.
   *
   * These violations matched an acknowledged rule ID and were excluded
   * from the active violations list. They are retained for audit
   * trail and reporting purposes.
   *
   * @default - no suppressed violations
   */
  readonly suppressedViolations?: SuppressedViolationJson[];
}

/**
 * The final conclusion of a validation report.
 */
export type PolicyValidationReportConclusion = 'success' | 'failure';

/**
 * A single policy violation found by a validation plugin.
 *
 * @example
 * import { PolicyViolationJson } from '@aws-cdk/cloud-assembly-schema';
 *
 * const violation: PolicyViolationJson = {
 *   ruleName: 'no-public-access',
 *   description: 'S3 bucket should not allow public access',
 *   severity: 'error',
 *   violatingConstructs: [{ constructPath: 'MyStack/MyBucket' }],
 * };
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

  /**
   * Stack traces associated with this violation
   *
   * This can be all the stack traces where a violating property got its value,
   * or just the construct creation stack trace.
   *
   * Every element of the array is a stack trace, where each stack trace is a `\n`-delimited string.
   *
   * @default - No stack traces
   */
  readonly stackTraces?: string[];
}

/**
 * A violation that was acknowledged/suppressed and excluded from the
 * active violation set.
 *
 * @example
 * import { SuppressedViolationJson } from '@aws-cdk/cloud-assembly-schema';
 *
 * const suppressed: SuppressedViolationJson = {
 *   ruleName: 'no-public-access',
 *   description: 'S3 bucket should not allow public access',
 *   severity: 'warning',
 *   violatingConstructs: [{ constructPath: 'MyStack/MyBucket' }],
 *   acknowledgedId: 'my-plugin::no-public-access',
 * };
 */
export interface SuppressedViolationJson extends PolicyViolationJson {
  /**
   * The acknowledgement ID that caused this violation to be suppressed.
   *
   * Format: `<plugin-name>::<rule-name>` (spaces replaced with hyphens).
   */
  readonly acknowledgedId: string;

  /**
   * The reason given for the acknowledgement, if provided.
   *
   * @default - no reason given
   */
  readonly reason?: string;

  /**
   * The construct path where the acknowledgement was declared.
   *
   * @default - unknown
   */
  readonly acknowledgedAt?: string;

  /**
   * Stack trace showing where the acknowledgement was declared.
   *
   * A `\n`-delimited string of stack frames.
   *
   * @default - no stack trace
   */
  readonly acknowledgedStackTrace?: string;
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
