import type { PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
import type { IMessageSpan } from '../../api/io/private/span';
import { sum } from '../../util';

/**
 * Add counters describing the online validation outcome to the given span
 *
 * `onlineViolations` counts the violations online validation reported, and
 * `online:stacksIncomplete` records how many selected stacks could not be
 * validated (0 on a clean run; every selected stack when the engine could not
 * run at all, e.g. a setup failure before validation started). Both are always
 * emitted so consumers can distinguish zero from missing data.
 */
export function countOnlineValidationResults(span: IMessageSpan<any>, onlineReports: PluginReportJson[] | undefined, incompleteStacks: number) {
  span.incCounter('onlineViolations', sum((onlineReports ?? []).map((r) => r.violations.length)));
  span.incCounter('online:stacksIncomplete', incompleteStacks);
}
