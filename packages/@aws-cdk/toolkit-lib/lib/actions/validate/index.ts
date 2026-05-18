import type { PolicyValidationReportJson, PolicyValidationReportStatus, PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
import type { StackSelector } from '../../api/cloud-assembly';

export interface ValidateOptions {
  /**
   * Select the stacks to validate
   */
  readonly stacks?: StackSelector;

  /**
   * Submit templates to CloudFormation for early validation.
   *
   * Creates a non-executing change set per stack and reports any
   * early validation errors (invalid resource types, property validation, name conflicts).
   * Requires AWS credentials.
   *
   * @default true
   */
  readonly online?: boolean;
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
  readonly status: PolicyValidationReportStatus;

  /**
   * The title of the validation report
   */
  readonly title?: string;

  /**
   * Reports from each validation plugin
   */
  readonly pluginReports: PluginReportJson[];
}

export type { PolicyValidationReportJson, PolicyValidationReportStatus, PluginReportJson };
