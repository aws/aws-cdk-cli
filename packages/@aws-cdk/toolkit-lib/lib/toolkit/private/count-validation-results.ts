import type { PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
import type { IMessageSpan } from '../../api/io/private/span';
import { sum } from '../../util';

/**
 * Add counters describing the online validation outcome to the given span
 *
 * Only the online violation count is recorded here. `online:stacksIncomplete`
 * (stacks whose online validation could not be completed) is incremented as
 * failures occur while online validation runs.
 */
export function countOnlineValidationResults(span: IMessageSpan<any>, onlineReports: PluginReportJson[] | undefined) {
  span.incCounter('onlineViolations', sum((onlineReports ?? []).map((r) => r.violations.length)));
}
