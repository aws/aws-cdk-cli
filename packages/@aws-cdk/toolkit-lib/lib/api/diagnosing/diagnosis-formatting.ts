import { sideBySide, TreeBuilder, wrapText } from './tree-builder';
import type { DiagnosedStack, StackDiagnosis, StackProblemSource, TracedResourceError } from '../../actions/diagnose';
import { DeploymentError, ToolkitError } from '../../toolkit/toolkit-error';
import { sortByKey } from '../../util';
import type { ActionLessMessage } from '../io/private';
import { IO } from '../io/private';

/**
 * Turn the given stack diagnosis result into an IO message, with default message formatting
 *
 * The default message formatting is what the CLI will print.
 */
export function hostMessageFromDiagnosis(stack: DiagnosedStack): ActionLessMessage<any> {
  const diagnosis = stack.result;

  switch (diagnosis.type) {
    case 'no-problem':
      return IO.CDK_TOOLKIT_I9500.msg(formatNoProblemStack(stack, diagnosis), stack);

    case 'problem':
      return IO.CDK_TOOLKIT_E9500.msg(formatProblemStack(stack, diagnosis), stack);

    case 'error-diagnosing':
      return IO.CDK_TOOLKIT_W9501.msg(formatDiagnosisErrorStack(stack, diagnosis), stack);
  }
}

/**
 * Turn the given diagnosis into a DeploymentError
 */
export function throwDeploymentErrorFromDiagnosis(diag: StackDiagnosis): never {
  switch (diag.type) {
    case 'no-problem':
      throw new ToolkitError('DeploymentErrorNotError', 'Diagnosis should represent an error, but does not');

    case 'error-diagnosing':
      throw new DeploymentError(diag.message, 'ErrorDiagnosisFailed');
  }
  // Guaranteed 'type=problem' here

  const errorCode = diag.problems[0]?.errorCode;
  let defaultErrorCode;
  switch (diag.detectedBy.type) {
    case 'change-set':
      defaultErrorCode = 'ChangeSetCreationFailed';
      break;

    case 'early-validation':
      defaultErrorCode = 'EarlyValidationFailure';
      break;

    case 'deployment':
      defaultErrorCode = 'StackDeployFailed';
      break;
  }

  throw new DeploymentError(formatProblemDiagnosis(diag), errorCode ?? defaultErrorCode);
}

function formatProblemDiagnosis(diag: Extract<StackDiagnosis, { type: 'problem' }>): string {
  switch (diag.detectedBy.type) {
    case 'change-set':
      return formatChangeSetProblems(diag.problems, diag.detectedBy);

    case 'early-validation':
      return formatEarlyValidationProblems(diag.problems, diag.detectedBy);

    case 'deployment':
      return formatDeploymentProblems(diag.problems, diag.detectedBy);
  }
}

function formatChangeSetProblems(problems: TracedResourceError[], detectedBy: Extract<StackProblemSource, { type: 'change-set' }>): string {
  const caption = `Failed to create change set ${detectedBy.changeSetName}`;

  if (problems.length > 0) {
    return `${caption}:\n${formatResourceErrors(problems)}`;
  } else {
    return `${caption}: ${detectedBy.statusReason}`;
  }
}

function formatEarlyValidationProblems(problems: TracedResourceError[], detectedBy: Extract<StackProblemSource, { type: 'early-validation' }>): string {
  const caption = `Early validation failed for change set ${detectedBy.changeSetName}`;
  if (problems.length > 0) {
    return `${caption}:\n${formatResourceErrors(problems)}`;
  } else {
    return caption;
  }
}

function formatDeploymentProblems(problems: TracedResourceError[], detectedBy: Extract<StackProblemSource, { type: 'deployment' }>): string {
  const caption = 'Errors encountered during deployment';

  if (problems.length > 0) {
    return `${caption}:\n${formatResourceErrors(problems)}`;
  } else {
    return `${caption} (${detectedBy.stackStatus}): ${detectedBy.statusReason}`;
  }
}

function formatNoProblemStack(stack: DiagnosedStack, _m: Extract<StackDiagnosis, { type: 'no-problem' }>) {
  // TODO: print stack by construct path, not name
  return `✅ Stack ${stack.stackName}: no issues found.`;
}

function formatProblemStack(stack: DiagnosedStack, m: Extract<StackDiagnosis, { type: 'problem' }>) {
  // TODO: print stack by construct path, not name
  return `❌ Stack ${stack.stackName}:\n${formatProblemDiagnosis(m)}`;
}

function formatDiagnosisErrorStack(stack: DiagnosedStack, m: Extract<StackDiagnosis, { type: 'error-diagnosing' }>) {
  // TODO: print stack by construct path, not name
  return `⚠️ Could not diagnose stack ${stack.stackName}: ${m.message}`;
}

function formatResourceErrors(es: TracedResourceError[]) {
  sortByKey(es, (e) => [locateResourceError(e)]);

  const b = new TreeBuilder('');
  for (const e of es) {
    const p = locateResourceError(e);
    const lastPart = p.split('/').slice(-1)[0];
    b.setNodeText(p, [
      `${lastPart}  ${addendum(' ', e.resourceType, e.logicalId)}`.trim(),
      ...sideBySide(['🛑'], ' ', wrapText(120, e.message)),
      ...e.sourceTrace?.creationStackTrace ? sideBySide(['Source Location:'], ' ', e.sourceTrace?.creationStackTrace) : [],
    ].join('\n'));
  }
  return b.render();
}

/**
 * Return a /-separated construct path for the given error, or try to build as close a represention as possible if we don't have a construct path
 *
 * The root will be the "app"
 */
function locateResourceError(e: TracedResourceError): string {
  if (e.sourceTrace?.constructPath) {
    return e.sourceTrace?.constructPath;
  }

  const nestedStackParts = e.parentStackLogicalIds.map((l) => `Nested stack ${l}`);
  if (e.logicalId) {
    return [e.topLevelStackHierarchicalId, ...nestedStackParts, e.logicalId].join('/');
  }
  // No logical ID means we are targeting the stack itself
  return [e.topLevelStackHierarchicalId, nestedStackParts].join('/');
}

function addendum(sep: string, ...xs: Array<string | undefined>): string {
  xs = xs.filter(x => x && typeof x === 'string');
  if (xs.length > 0) {
    return `(${xs.join(sep)})`;
  } else {
    return '';
  }
}
