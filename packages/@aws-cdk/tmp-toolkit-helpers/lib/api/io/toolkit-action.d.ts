/**
 * The current action being performed by the CLI. 'none' represents the absence of an action.
 */
export type ToolkitAction = 'assembly' | 'bootstrap' | 'synth' | 'list' | 'diff' | 'deploy' | 'rollback' | 'watch' | 'destroy' | 'doctor' | 'gc' | 'import' | 'metadata' | 'init' | 'migrate' | 'refactor';
