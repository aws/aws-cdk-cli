// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../cli-type-registry.json');

/**
 * Build a set of all known option names for a given option definitions object.
 * Includes the kebab-case name, its camelCase equivalent, all aliases, and negativeAliases.
 */
function collectKnownOptions(optionDefs: Record<string, any>): Set<string> {
  const known = new Set<string>();
  for (const [name, def] of Object.entries<any>(optionDefs)) {
    known.add(name);
    known.add(kebabToCamel(name));
    if (def.alias) {
      const aliases = Array.isArray(def.alias) ? def.alias : [def.alias];
      for (const a of aliases) {
        known.add(a);
      }
    }
    if (def.negativeAlias) {
      known.add(def.negativeAlias);
    }
  }
  return known;
}

/** Pre-computed set of known global options (static, doesn't depend on argv) */
const globalKnownOptions = collectKnownOptions(config.globalOptions);

/** yargs internal keys that are always present in argv */
const yargsInternals = new Set(['_', '$0', 'help', 'h', 'version']);

/**
 * Detect unrecognized CLI options.
 *
 * Yargs does not enable strict option checking by default, so unknown flags
 * are silently swallowed. This function compares the parsed argv keys against
 * the known global and command options from the CLI type registry and returns
 * any that don't match.
 */
export function findUnknownOptions(argv: any): string[] {
  const command = argv._[0];

  const commandDef = config.commands[command];
  const commandKnownOptions = commandDef?.options
    ? collectKnownOptions(commandDef.options)
    : new Set<string>();

  const positionalArg = commandDef?.arg?.name;

  const unknown: string[] = [];
  for (const key of Object.keys(argv)) {
    if (argv[key] === undefined) {
      continue;
    }
    if (yargsInternals.has(key) || key === positionalArg) {
      continue;
    }
    if (globalKnownOptions.has(key) || commandKnownOptions.has(key)) {
      continue;
    }
    // yargs .env('CDK') injects CDK_* environment variables as camelCase argv
    // keys (e.g. CDK_INTEG_ATMOSPHERE_POOL -> integAtmospherePool). These are
    // intentional configuration from the environment, not user typos.
    if (isFromEnvPrefix(key, 'CDK')) {
      continue;
    }

    unknown.push(key);
  }

  return unknown;
}

function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Checks whether a camelCase argv key was injected by yargs' .env(PREFIX)
 * feature. yargs converts PREFIX_FOO_BAR env vars into camelCase keys
 * (fooBar). We reverse the mapping and check if the env var exists.
 */
function isFromEnvPrefix(key: string, prefix: string): boolean {
  const screamingSnake = key.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase();
  return process.env[`${prefix}_${screamingSnake}`] !== undefined;
}
