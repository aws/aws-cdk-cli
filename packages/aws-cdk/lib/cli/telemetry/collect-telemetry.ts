import type { Context } from '../../api/context';

/**
 * Whether or not we collect telemetry
 */
export function canCollectTelemetry(args: any, context: Context): boolean {
  if (
    ['true', '1'].includes(process.env.CDK_CLI_DISABLE_TELEMETRY ?? '') || 
    ['false', false].includes(context.get('cli-telemetry')) ||
    !args['version-reporting'] // aliased with disable-telemetry
  ) {
    return false;
  }

  return true;
}
