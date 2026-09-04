import { wouldFailDeploy } from './validation-report';
import type { ValidateResult } from '../../actions/validate';
import type { IMessageSpan } from '../../api/io/private/span';
import { sum } from '../../util';

/**
 * Add counters describing the outcome of a validate run to the given span
 *
 * Offline violations (policy plugin reports and construct annotations read
 * from the cloud assembly) are counted per severity. `offlineWouldFailDeploy`
 * records whether the offline reports fail `wouldFailDeploy` at the default
 * 'error' threshold; a deploy run with `--strict` or `--ignore-errors` moves
 * that threshold, so this counter approximates the default deploy behavior.
 *
 * Online reports are identified by reference via `onlineReports`, not by
 * plugin name: `pluginName` is a plugin-supplied string, so an offline
 * policy plugin may carry any name.
 */
export function countValidationResults(span: IMessageSpan<any>, result: ValidateResult) {
  const online = result.onlineReports ?? [];
  const onlineSet = new Set(online);
  const offline = result.pluginReports.filter((r) => !onlineSet.has(r));

  for (const report of offline) {
    for (const violation of report.violations) {
      span.incCounter(`offlineViolations:${violation.severity}`);
    }
  }

  span.incCounter('onlineViolations', sum(online.map((r) => r.violations.length)));
  span.incCounter('offlineWouldFailDeploy', wouldFailDeploy(offline, 'error') ? 1 : 0);
}
