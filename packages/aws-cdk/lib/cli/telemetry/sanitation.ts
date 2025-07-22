import { join } from 'path';
import * as fs from 'fs-extra';
import { FeatureFlag } from './feature-flags';
import type { Context } from '../../api/context';

export const CLI_TYPE_REGISTRY_FILE = 'cli-type-registry.json';

/**
 * argv is the output of yargs
 */
export function sanitizeCommandLineArguments(argv: any): { path: string[]; parameters: { [key: string]: string } } {
  // Get the configuration of the arguments
  const config = fs.readJSONSync(join(__dirname, '..', CLI_TYPE_REGISTRY_FILE));
  const command = argv._[0];
  const path: string[] = [command];
  const parameters: { [key: string]: string } = {};

  const globalOptions: any[] = Object.keys(config.globalOptions);
  const commandOptions: any[] = Object.keys(config.commands[command]?.options ?? {});
  const commandArg: { name: string; variadic: string } | undefined = config.commands[command]?.arg;

  for (const argName of Object.keys(argv)) {
    if (argName === commandArg?.name) {
      if (commandArg.variadic) {
        for (let i = 0; i < argv[argName].length; i++) {
          path.push(`$${argName}_${i+1}`);
        }
      } else {
        path.push(`$${argName}`);
      }
    }

    // Continue if the arg name is not a global option or command option
    // arg name comes from yargs and could be an alias; we trust that the "normal"
    // name has the same information and that is what we want to record
    if (argv[argName] === undefined || (!globalOptions.includes(argName) && !commandOptions.includes(argName))) {
      continue;
    }
    if (isNumberOrBoolean(argv[argName])) {
      parameters[argName] = argv[argName];
    } else {
      parameters[argName] = '<redacted>';
    }
  }

  return {
    path,
    parameters,
  };
}

export function sanitizeContext(context: Context) {
  const sanitizedContext: { [K in FeatureFlag]: boolean } = {} as { [K in FeatureFlag]: boolean };
  for (const [flag, value] of Object.entries(context.all)) {
    // Skip if flag is not in the FeatureFlags enum
    if (!isFeatureFlag(flag)) {
      continue;
    }

    // Falsy options include boolean false, string 'false'
    // All other inputs evaluate to true
    const sanitizedValue: boolean = isBoolean(value) ? value : (value !== 'false');
    sanitizedContext[flag] = sanitizedValue;
  }
  return sanitizedContext;
}

function isBoolean(value: any): value is boolean {
  return typeof value === 'boolean';
}

function isNumberOrBoolean(value: any): boolean {
  return typeof value === 'number' || isBoolean(value);
}

function isFeatureFlag(flag: string): flag is FeatureFlag {
  return Object.values(FeatureFlag).includes(flag as FeatureFlag);
}
