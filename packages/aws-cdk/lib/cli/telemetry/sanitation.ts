import { join } from 'path';
import * as fs from 'fs-extra';
import type { Command } from './schema';

export const CLI_TYPE_REGISTRY_FILE = 'cli-type-registry.json';

/**
 * argv is the output of yargs
 */
export function sanitizeCommandLineArguments(argv: any): Command {
  // Get the configuration of the arguments
  const config = fs.readJSONSync(join(__dirname, '..', CLI_TYPE_REGISTRY_FILE));
  const command = argv._[0];
  const path: string[] = [command];
  const parameters: { [key: string]: string } = {};

  const globalOptions = Object.keys(config.globalOptions);
  const commandOptions = Object.keys(config.commands[command].options ?? {});
  const commandArg = config.commands[command].arg;

  for (const argName of Object.keys(argv)) {
    if (argName === commandArg?.name) {
      const arg = dropDuplicate(argName);
      if (commandArg.variadic) {
        for (let i = 0; i < argv[argName].length; i++) {
          path.push(`$${arg}${i+1}`);
        }
      } else {
        path.push(`$${arg}1`);
      }
    }

    // Continue if the arg name is not a global option or command option
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
    config: {},
  };
}

export function sanitizeContext(context: { [key: string]: any }) {
  const sanitizedContext: { [key: string]: boolean } = {};
  for (const [flag, value] of Object.entries(context)) {
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
  return typeof value === 'number' || typeof value === 'boolean';
}

function dropDuplicate(param: string): string {
  return param.endsWith('S') ? param.slice(0, param.length-1) : param;
}
