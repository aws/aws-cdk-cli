import * as path from 'path';
import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import { SynthesisMessageLevel } from '@aws-cdk/cloud-assembly-api';
import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import * as fs from 'fs-extra';
import type { IMessageSpan } from '../../api/io/private/span';
import { sum } from '../../util';

const VALIDATION_REPORT_FILE = 'validation-report.json';

export function countAssemblyResults(span: IMessageSpan<any>, assembly: cxapi.CloudAssembly) {
  const stacksRecursively = assembly.stacksRecursively;
  span.incCounter('stacks', stacksRecursively.length);
  span.incCounter('assemblies', asmCount(assembly));
  span.incCounter('errorAnns', sum(stacksRecursively.map(s => s.messages.filter(m => m.level === SynthesisMessageLevel.ERROR).length)));
  span.incCounter('warnings', sum(stacksRecursively.map(s => s.messages.filter(m => m.level === SynthesisMessageLevel.WARNING).length)));
  span.incCounter('offlineWouldFailDeploy', offlineWouldFailDeploy(assembly) ? 1 : 0);

  const annotationErrorCodes = stacksRecursively
    .flatMap(s => Object.values(s.metadata ?? {})
      .flatMap(ms => ms.filter(m => m.type === ANNOTATION_ERROR_CODE_TYPE)));
  for (const annotationErrorCode of annotationErrorCodes) {
    span.incCounter(`errorAnn:${annotationErrorCode.data}`);
  }

  function asmCount(x: cxapi.CloudAssembly): number {
    return 1 + x.nestedAssemblies.reduce((acc, asm) => acc + asmCount(asm.nestedAssembly), 0);
  }
}

/**
 * Whether the offline validation results would have failed a default `cdk deploy`
 *
 * Mirrors `wouldFailDeploy` at the default 'error' threshold over the whole
 * assembly (independent of any `--strict`/`--ignore-errors` on the current
 * command): a deploy fails if there are error-level construct annotations or a
 * policy plugin reported a failure.
 */
export function offlineWouldFailDeploy(assembly: cxapi.CloudAssembly): boolean {
  const hasErrorAnnotations = assembly.stacksRecursively.some(
    s => s.messages.some(m => m.level === SynthesisMessageLevel.ERROR),
  );
  if (hasErrorAnnotations) {
    return true;
  }

  const reportPath = path.join(assembly.directory, VALIDATION_REPORT_FILE);
  if (!fs.existsSync(reportPath)) {
    return false;
  }
  return Manifest.loadValidationReport(reportPath).pluginReports.some(r => r.conclusion === 'failure');
}

/**
 * Well-known and agreed-upon value between aws-cdk-lib and the toolkit
 *
 * Do not change, obviously.
 */
const ANNOTATION_ERROR_CODE_TYPE = 'aws:cdk:error-code';
