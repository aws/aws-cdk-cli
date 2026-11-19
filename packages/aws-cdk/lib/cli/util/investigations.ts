import type { Investigations } from '@aws-cdk/toolkit-lib';
import { ToolkitError } from '@aws-cdk/toolkit-lib';

/**
 * CLI names of the investigations, mapped to their toolkit-lib keys
 */
const INVESTIGATION_NAMES: Record<string, keyof Investigations> = {
  'cloudtrail': 'cloudTrail',
  'custom-resources': 'customResources',
  'ecs': 'ecs',
  'hooks': 'hooks',
};

/**
 * Parse `--investigate` values (or the `investigate` setting from `cdk.json`) into investigations.
 *
 * Values apply in order: a name enables that investigation, `no-<name>` disables it, and
 * `all`/`none` set every investigation. Values may also be comma-separated. Investigations
 * that are not mentioned are left unset, so the command's defaults apply to them.
 */
export function parseInvestigations(values: unknown): Investigations | undefined {
  if (values === undefined) {
    return undefined;
  }
  if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) {
    throw new ToolkitError('InvalidInvestigations', `investigate must be a list of strings, got: ${JSON.stringify(values)}`);
  }

  const ret: { -readonly [K in keyof Investigations]: boolean } = {};
  for (const value of values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter((v) => v)) {
    if (value === 'all' || value === 'none') {
      for (const key of Object.values(INVESTIGATION_NAMES)) {
        ret[key] = value === 'all';
      }
      continue;
    }

    const enable = !value.startsWith('no-');
    const key = INVESTIGATION_NAMES[enable ? value : value.slice('no-'.length)];
    if (!key) {
      throw new ToolkitError(
        'InvalidInvestigations',
        `unknown investigation '${value}'; use one of ${Object.keys(INVESTIGATION_NAMES).join(', ')} (prefix with no- to disable), all, or none`,
      );
    }
    ret[key] = enable;
  }
  return ret;
}
