/**
 * @deprecated
 */
export enum RequireApproval {
  /**
   * Never require any security approvals
   */
  NEVER = 'never',
  /**
   * Any security changes require an approval
   */
  ANY_CHANGE = 'any-change',
  /**
   * Require approval only for changes that are access broadening
   */
  BROADENING = 'broadening',
}
