import { ToolkitError } from '@aws-cdk/toolkit-lib';

/**
 * Result of bootstrap error detection
 */
export interface BootstrapErrorInfo {
  readonly isBootstrapError: boolean;
  readonly region?: string;
  readonly account?: string;
  readonly message: string;
}

/**
 * Detects if an error is a bootstrap-related error
 */
export function detectBootstrapError(error: unknown): BootstrapErrorInfo {
  // Check for strongly-typed BootstrapError
  if (ToolkitError.isBootstrapError(error)) {
    return {
      isBootstrapError: true,
      region: error.environment.region,
      account: error.environment.account,
      message: error.message,
    };
  }

  const errorMessage = error instanceof Error ? error.message : String(error);

  return {
    isBootstrapError: false,
    message: errorMessage,
  };
}
