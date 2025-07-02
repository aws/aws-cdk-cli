import { Context } from "../../api/context";

/**
 * Whether or not we collect telemetry
 */
export function collectTelemetry(context: Context): boolean {
  // TODO: remove this at launch. for now, this is an opt-in
  if (process.env.CLI_TELEMETRY === 'true') {
    return true;
  }

  if (!process.env.DISABLE_CLI_TELEMETRY && context.get('cli-telemetry')) {
    return true;
  }

  return false;
}