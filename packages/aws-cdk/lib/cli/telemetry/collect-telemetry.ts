import type { Context } from '../../api/context';

/**
 * Whether or not we collect telemetry
 */
export function canCollectTelemetry(args: any, context: Context): boolean {
  if ((['true', '1'].includes(process.env.CDK_DISABLE_CLI_TELEMETRY ?? '')) ||
    ['false', false].includes(context.get('cli-telemetry')) ||
    (args['version-reporting'] !== undefined && !args['version-reporting']) || /* aliased with telemetry option */
    (Array.isArray(args._) && args._[0] === 'cli-telemetry' && args.disable)) /* special case for `cdk cli-telemetry --disable` */ {
    return false;
  }

  return true;
}
