/* eslint-disable import/no-relative-packages */
// Re-exported from its defining module rather than from the `@aws-cdk/toolkit-lib` barrel, so the deep
// path is stated once instead of copied into every file that needs it.
//
// Required for `sender.ts`, `post-telemetry.ts` and `proxy-agent.ts`: those are the detached telemetry
// sender's bundle graph, and the barrel would drag the whole toolkit (~11MB) into it for the sake of
// one error class. The other telemetry files import it for consistency rather than necessity.
//
// `lib/api-private.ts` is not a substitute even though it re-exports from the same package: it also
// exports `deployStack`, `cfnApi`, the change-set describer and the activity printer, so importing it
// would pull the entire deployment path into the sender's graph -- the opposite of the point.
export { ToolkitError } from '../../@aws-cdk/toolkit-lib/lib/toolkit/toolkit-error';
