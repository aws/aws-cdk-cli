import { DiagnosedStack, StackDiagnosis, StackProblemSource, TracedResourceError } from "../../actions/diagnose";
import { ActionLessMessage, IO } from "../io/private";
import { DeploymentError, ToolkitError } from "../../toolkit/toolkit-error";

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
      throw new DeploymentError('ErrorDiagnosisFailed', diag.message);
  }
  // Guaranteed 'type=problem' here

  const errorCode = diag.problems[0]?.errorCode;
  switch (diag.detectedBy.type) {
    case 'change-set':
      throw new DeploymentError(formatChangeSetProblems(diag.problems, diag.detectedBy), errorCode ?? 'ChangeSetCreationFailed');

    case 'early-validation':
      throw new DeploymentError(formatEarlyValidationProblems(diag.problems, diag.detectedBy), 'EarlyValidationFailure');

    case 'deployment':
      throw new DeploymentError(formatDeploymentProblems(diag.problems, diag.detectedBy), errorCode ?? 'StackDeployFailed');
  }
}

function formatChangeSetProblems(problems: TracedResourceError[], detectedBy: Extract<StackProblemSource, { type: 'change-set' }>): string {
  const caption = `Failed to create ChangeSet ${detectedBy.changeSetName}`;

  if (problems.length > 0) {
    return `${caption}:\n${formatResourceErrors(problems)}`;
  } else {
    return `${caption}: ${detectedBy.statusReason}`;
  }
}

function formatEarlyValidationProblems(problems: TracedResourceError[], detectedBy: Extract<StackProblemSource, { type: 'early-validation' }>): string {
  const caption = `Early validation failed for Changeset ${detectedBy.changeSetName}`;
  if (problems.length > 0) {
    return `${caption}:\n${formatResourceErrors(problems)}`;
  } else {
    return caption;
  }
}

function formatDeploymentProblems(problems: TracedResourceError[], detectedBy: Extract<StackProblemSource, { type: 'deployment' }>): string {
  const caption = `Errors encountered during deployment`;

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
  return `❌ Stack ${stack.stackName}:\n${formatResourceErrors(m.problems)}`;
}

function formatDiagnosisErrorStack(stack: DiagnosedStack, m: Extract<StackDiagnosis, { type: 'error-diagnosing' }>) {
  // TODO: print stack by construct path, not name
  return `⚠️ Could not diagnose stack ${stack.stackName}: ${m.message}`;
}

function formatResourceErrors(es: TracedResourceError[]) {
  return es.map((x) => JSON.stringify(x, undefined, 2)).map((x) => `-  ${x}`).join('\n')
}