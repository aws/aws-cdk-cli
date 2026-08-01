import * as util from 'node:util';
import type { GetHookResultCommandOutput, HookResultSummary } from '@aws-sdk/client-cloudformation';
import type { ICloudFormationClient } from '../aws-auth/private';
import { isAccessDeniedError } from '../aws-auth/util';
import type { EnvironmentResources } from '../environment';
import type { IoHelper } from '../io/private';

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

export interface FetchHookResultDetailsOptions {
  /**
   * The IoHelper used to warn when the fetch fails.
   */
  readonly ioHelper: IoHelper;

  /**
   * Environment resources, used to look up the bootstrap toolkit version when
   * diagnosing hook result fetch failures caused by missing permissions.
   *
   * @default - Bootstrap version is not reported in error messages
   */
  readonly envResources?: EnvironmentResources;
}

/**
 * Fetch a hook invocation's failure details via the `GetHookResult` API and format
 * them into a human-readable string.
 *
 * For Guard Hooks the details come from the failed annotations; for other hooks
 * (e.g. Lambda Hooks) they come from the hook result's own status reason.
 * Returns undefined if the fetch fails (emitting a warning, with a bootstrap
 * upgrade hint if the failure looks permissions-related) or the result carries
 * no failure details.
 */
export async function fetchHookResultDetails(
  cfn: ICloudFormationClient,
  hookInvocationId: string,
  options: FetchHookResultDetailsOptions,
): Promise<string | undefined> {
  try {
    const result = await cfn.getHookResult({ HookResultId: hookInvocationId });
    return formatHookResultDetails(result);
  } catch (e: any) {
    const errorMessage = e instanceof Error ? e.message : String(e);

    const isPermissionsError =
      isAccessDeniedError(e) ||
      (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('not authorized to perform: cloudformation:gethookresult'));

    if (isPermissionsError && options.envResources) {
      let currentVersion: number | undefined = undefined;
      try {
        currentVersion = (await options.envResources.lookupToolkit()).version;
      } catch {
        // ignore errors looking up the bootstrap version
      }

      await options.ioHelper.defaults.warn(
        `Failed to fetch result details for Hook invocation ${hookInvocationId}: ${errorMessage}. ` +
        'Make sure you have permissions to call the GetHookResult API, or re-bootstrap your environment ' +
        "by running 'cdk bootstrap' to update the Bootstrap CDK Toolkit stack. " +
        `Bootstrap toolkit stack version 31 or later is needed; current version: ${currentVersion ?? 'unknown'}.`,
      );
    } else {
      await options.ioHelper.defaults.warn(
        util.format('Failed to fetch Hook details for invocation %s: %s', hookInvocationId, errorMessage),
      );
    }

    return undefined;
  }
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
