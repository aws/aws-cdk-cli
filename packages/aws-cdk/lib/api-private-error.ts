/* eslint-disable import/no-relative-packages */
// Mimics `api-private.ts`, but intentionally smaller: it exports only `ToolkitError`, so the detached
// telemetry sender's bundle does not pull in the whole toolkit.
export { ToolkitError } from '../../@aws-cdk/toolkit-lib/lib/toolkit/toolkit-error';
