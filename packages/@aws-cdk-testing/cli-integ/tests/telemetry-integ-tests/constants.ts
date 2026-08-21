export const CURRENT_TELEMETRY_VERSION = '2.0';

/**
 * How long to keep watching a telemetry endpoint after the CLI has exited, when proving that nothing
 * was sent.
 *
 * Delivery is asynchronous and handled by a detached child, so "nothing arrived" is only meaningful
 * once we have waited longer than a successful delivery would have taken. The positive test
 * (`cdk-telemetry-reaches-the-endpoint`) normally sees its batch within a second or two, so this is
 * already several times the observed latency.
 */
export const TELEMETRY_QUIET_PERIOD_MS = 5_000;
