/**
 * Different types of permission related changes in a diff
 */
export enum PermissionChangeType {
  /**
   * No permission changes
   */
  NONE = 'none',

  /**
   * Permissions are broadening
   */
  BROADENING = 'broadening',

  /**
   * Permissions are changed but not broadening
   */
  NON_BROADENING = 'non-broadening',
}
