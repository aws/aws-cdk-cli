/* eslint-disable import/no-relative-packages */
// Re-exported from its defining module rather than from the `@aws-cdk/toolkit-lib` barrel. Every
// importer of this file is in the detached telemetry sender's bundle graph, and the barrel would drag
// the whole toolkit (~11MB) in for the sake of one error class. Kept in one place so the deep path is
// stated once rather than copied into each of those files.
export { ToolkitError } from '../../@aws-cdk/toolkit-lib/lib/toolkit/toolkit-error';
