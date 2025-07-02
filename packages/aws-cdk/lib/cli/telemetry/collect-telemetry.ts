import { Context } from "../../api/context";

/**
 * Whether or not we collect telemetry
 */
export function canCollectTelemetry(context: Context): boolean {
  // TODO: remove this at launch. for now, this is an opt-in
  if (!process.env.CLI_TELEMETRY) {
    return false;
  }

  if (process.env.DISABLE_CLI_TELEMETRY || context.get('cli-telemetry') !== true) {
    return false;
  }

  return true;
}