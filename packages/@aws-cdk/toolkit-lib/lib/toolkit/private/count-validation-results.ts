import type { ValidateResult } from '../../actions/validate';
import type { IMessageSpan } from '../../api/io/private/span';

/**
 * Add counters describing the outcome of a validate run to the given span
 *
 * Offline violations (policy plugin reports and construct annotations read
 * from the cloud assembly) are counted per severity. An offline report with a
 * 'failure' conclusion is the exact condition that makes deploy-like actions
 * throw (see `throwIfValidationFailures`), so `offlineWouldFailDeploy` records
 * that offline validation caught an error before a deployment attempt.
 *
 * Online reports are identified by reference via `onlineReports`, not by
 * plugin name: `pluginName` is a plugin-supplied string, so an offline
 * policy plugin may carry any name.
 */
export function countValidationResults(span: IMessageSpan<any>, result: ValidateResult) {
  const onlineSet = new Set(result.onlineReports ?? []);
  const offline = result.pluginReports.filter((r) => !onlineSet.has(r));
  const online = result.pluginReports.filter((r) => onlineSet.has(r));

  for (const report of offline) {
    for (const violation of report.violations) {
      span.incCounter(`offlineViolations:${violation.severity}`);
    }
  }

  span.incCounter('onlineViolations', sum(online.map((r) => r.violations.length)));
  span.incCounter('offlineWouldFailDeploy', offline.some((r) => r.conclusion === 'failure') ? 1 : 0);
}

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
