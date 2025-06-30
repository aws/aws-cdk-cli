/**
 * Whether or not we collect telemetry
 */
export function collectTelemetry(): boolean {
  // TODO: customer opt outs
  if (process.env.CLI_TELEMETRY === 'true') {
    return true;
  }

  return false;
}