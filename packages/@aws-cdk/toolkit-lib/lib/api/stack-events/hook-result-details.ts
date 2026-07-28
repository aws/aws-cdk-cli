import type { GetHookResultCommandOutput, HookResultSummary } from '@aws-sdk/client-cloudformation';

/**
 * The relevant parts of a hook result, common to `GetHookResult` outputs and
 * `ListHookResults` summaries.
 */
export type HookResultDetails = Pick<GetHookResultCommandOutput, 'Status' | 'HookStatusReason' | 'Annotations'> | HookResultSummary;

/**
 * Format the failure details of a hook result into a human-readable string.
 *
 * - Guard Hooks report their details as annotations; failed annotations are
 *   formatted as a list of non-compliant rules.
 * - Other hooks (e.g. Lambda Hooks or custom hooks) don't emit annotations; their
 *   details live in the top-level `HookStatusReason` of the hook result, which is
 *   usually more detailed than the `HookStatusReason` found on stack events.
 *
 * Returns `undefined` if the result carries no failure details.
 */
export function formatHookResultDetails(result: HookResultDetails): string | undefined {
  const annotations = ('Annotations' in result ? result.Annotations : undefined) ?? [];
  const failedAnnotations = annotations.filter((a) => a.Status === 'FAILED');

  if (failedAnnotations.length > 0) {
    const lines: string[] = ['NonCompliant Rules:', ''];
    for (const annotation of failedAnnotations) {
      if (annotation.AnnotationName) {
        lines.push(`[${annotation.AnnotationName}]`);
      }
      if (annotation.StatusMessage) {
        lines.push(`• ${normalizeHookMessage(annotation.StatusMessage)}`);
      }
      if (annotation.RemediationMessage) {
        lines.push(`Remediation: ${normalizeHookMessage(annotation.RemediationMessage)}`);
      }
      lines.push('');
    }
    return lines.join('\n').trimEnd();
  }

  // No annotations (e.g. a Lambda Hook): fall back to the hook result's own status reason
  if (isFailedHookStatus(result.Status) && result.HookStatusReason) {
    return normalizeHookMessage(result.HookStatusReason);
  }

  return undefined;
}

/**
 * Whether the given hook status represents a failure
 */
export function isFailedHookStatus(status: string | undefined): boolean {
  return status === 'HOOK_COMPLETE_FAILED' || status === 'HOOK_FAILED';
}

/**
 * Trims leading/trailing whitespace, collapses all internal whitespace
 * (including newlines) to a single space, and truncates to `maxChars`
 * characters, appending `[...truncated]` when the original was longer.
 */
export function normalizeHookMessage(message: string, maxChars: number = 400): string {
  const normalized = message.trim().replace(/\s+/g, ' ');
  return normalized.length > maxChars
    ? normalized.substring(0, maxChars) + '[...truncated]'
    : normalized;
}
