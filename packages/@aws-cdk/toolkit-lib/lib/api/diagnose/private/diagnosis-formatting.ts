import { DiagnosedStack, StackDiagnosis, TracedResourceError } from "../types";
import { ActionLessMessage, IO } from "../../io/private";
import { DeploymentError, ToolkitError } from "../../../toolkit/toolkit-error";

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
  switch (diag.detectedBy) {
    case 'change-set':
      // TODO: format the problems in here
      throw new DeploymentError(`Failed to create ChangeSet:\n${formatResourceErrors(diag.problems)}`, errorCode ?? 'ChangeSetCreationFailed');

    case 'deployment':
      // TODO: format the problems in here
      throw new DeploymentError(`Errors encountered during deployment:\n${formatResourceErrors(diag.problems)}`, errorCode ?? 'StackDeployFailed');
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