/**
 * The current action being performed by the Toolkit.
 */
export type ToolkitAction =
| 'assembly'
| 'bootstrap'
| 'synth'
| 'list'
| 'diff'
| 'deploy'
| 'drift'
| 'rollback'
| 'watch'
| 'destroy'
| 'doctor'
| 'gc'
| 'import'
| 'metadata'
| 'init'
| 'migrate'
| 'refactor';
