import { formatProblemDiagnosis } from './diagnosis-formatting';
import type { StackDiagnosis, StackProblemSource, TracedResourceError } from '../../actions/diagnose';
import { DeploymentError } from '../../toolkit/toolkit-error';

/**
 * The outcome of diagnosing a stack, and what to do about it.
 *
 * This is the internal counterpart of the public `StackDiagnosis` type: it carries the same
 * information (available as `result`, which is what we hand out at the API boundary) plus the
 * behavior that belongs with it.
 */
export class Diagnosis {
  /**
   * No problem was found with the stack.
   */
  public static noProblem(): Diagnosis {
    return new Diagnosis({ type: 'no-problem' });
  }

  /**
   * A problem was found with the stack.
   */
  public static problem(detectedBy: StackProblemSource, problems: TracedResourceError[]): Diagnosis {
    return new Diagnosis({ type: 'problem', detectedBy, problems });
  }

  /**
   * Diagnosing the stack itself failed, so we cannot say whether there is a problem.
   */
  public static errorDiagnosing(message: string): Diagnosis {
    return new Diagnosis({ type: 'error-diagnosing', message });
  }

  private constructor(public readonly result: StackDiagnosis) {
  }

  public get type(): StackDiagnosis['type'] {
    return this.result.type;
  }

  /**
   * Whether this diagnosis represents a healthy stack.
   */
  public get isNoProblem(): boolean {
    return this.result.type === 'no-problem';
  }

  /**
   * Throw a `DeploymentError` describing the diagnosis, unless there is no problem.
   */
  public throwOnError(): void {
    switch (this.result.type) {
      case 'no-problem':
        return;

      case 'error-diagnosing':
        throw new DeploymentError(this.result.message, 'ErrorDiagnosisFailed');

      case 'problem':
        break;
    }

    const errorCode = this.result.problems[0]?.errorCode;
    let defaultErrorCode;
    switch (this.result.detectedBy.type) {
      case 'change-set':
        defaultErrorCode = 'ChangeSetCreationFailed';
        break;

      case 'change-set-not-ready':
        defaultErrorCode = 'ChangeSetNotReady';
        break;

      case 'early-validation':
        defaultErrorCode = 'EarlyValidationFailure';
        break;

      case 'deployment':
        defaultErrorCode = 'StackDeployFailed';
        break;
    }

    throw new DeploymentError(formatProblemDiagnosis(this.result), errorCode ?? defaultErrorCode);
  }
}
