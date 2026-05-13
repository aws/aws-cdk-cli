/**
 * Detect unrecognized CLI options and emit warnings.
 *
 * Yargs does not enable strict option checking by default, so unknown flags
 * like `--region` (before it was added) are silently swallowed. This function
 * compares the parsed argv keys against the known global and command options
 * from the CLI type registry and warns for any that don't match.
 */
export function findUnknownOptions(argv: any): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require('../cli-type-registry.json');
  const command = argv._[0];

  const globalOptions = new Set<string>(Object.keys(config.globalOptions));
  const commandOptions = new Set<string>(Object.keys(config.commands[command]?.options ?? {}));

  // Collect all known aliases and negativeAliases
  for (const [, optDef] of Object.entries<any>(config.globalOptions)) {
    if (optDef.alias) {
      const aliases = Array.isArray(optDef.alias) ? optDef.alias : [optDef.alias];
      for (const a of aliases) {
        globalOptions.add(a);
      }
    }
    if (optDef.negativeAlias) {
      globalOptions.add(optDef.negativeAlias);
    }
  }
  for (const [, optDef] of Object.entries<any>(config.commands[command]?.options ?? {})) {
    if (optDef.alias) {
      const aliases = Array.isArray(optDef.alias) ? optDef.alias : [optDef.alias];
      for (const a of aliases) {
        commandOptions.add(a);
      }
    }
    if (optDef.negativeAlias) {
      commandOptions.add(optDef.negativeAlias);
    }
  }

  // yargs internal keys to ignore
  const yargsInternals = new Set(['_', '$0', 'help', 'h', 'version']);

  // The command's positional arg name
  const commandArg = config.commands[command]?.arg?.name;
  if (commandArg) {
    yargsInternals.add(commandArg);
  }

  const unknown: string[] = [];
  for (const key of Object.keys(argv)) {
    if (argv[key] === undefined) continue;
    if (yargsInternals.has(key)) continue;
    if (globalOptions.has(key)) continue;
    if (commandOptions.has(key)) continue;

    // yargs creates camelCase versions of kebab-case options — skip those
    const kebab = camelToKebab(key);
    if (kebab !== key && (globalOptions.has(kebab) || commandOptions.has(kebab))) continue;

    // yargs creates "noFoo" keys for --no-foo boolean negations — skip those
    if (key.startsWith('no') && key.length > 2 && key[2] === key[2].toUpperCase()) {
      const positiveKey = key[2].toLowerCase() + key.slice(3);
      const positiveKebab = camelToKebab(positiveKey);
      if (globalOptions.has(positiveKey) || commandOptions.has(positiveKey) ||
          globalOptions.has(positiveKebab) || commandOptions.has(positiveKebab)) continue;
    }

    // yargs .env('CDK') injects CDK_* environment variables as camelCase argv
    // keys (e.g. CDK_INTEG_ATMOSPHERE_POOL -> integAtmospherePool). These are
    // intentional configuration from the environment, not user typos.
    if (isFromEnvPrefix(key, 'CDK')) continue;

    unknown.push(key);
  }

  return unknown;
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
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
