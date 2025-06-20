import { CliConfig } from "@aws-cdk/user-input-gen";
import { Command } from "./schema";

/**
 * argv is the output of yargs
 */
export function sanitizeCommandLineArguments(argv: any, config: CliConfig): Command {
  const command = argv._[0];
  const path: string[] = [];
  const parameters: string[] = [command];

  const globalOptions = Object.keys(config.globalOptions);
  const commandOptions = Object.keys(config.commands[command].options ?? {});
  const commandArg = config.commands[command].arg;
  for (const argName of Object.keys(argv)) {
    if (argv[argName] === undefined) { continue; }
    if (argName === commandArg?.name) {
      if (commandArg.variadic) {
        for (const _ of argv[argName]) {
          parameters.push(`<redacted-${argName}>`);
        }
      } else {
        parameters.push(`<redacted-${argName}>`);
      }
    }
    if (globalOptions.includes(argName)) {
      const type = config.globalOptions[argName].type;
      if (['number', 'boolean', 'count'].includes(type)) {
        path.push(`--${argName}=${argv[argName]}`);
      } else {
        path.push(`--${argName}=<redacted>`);
      }
    }
    if (commandOptions.includes(argName)) {
      const type = config.commands[command].options![argName].type;
      if (['number', 'boolean', 'count'].includes(type)) {
        path.push(`--${argName}=${argv[argName]}`);
      } else {
        path.push(`--${argName}=<redacted>`);
      }
    }
  }

  return {
    path,
    parameters,
    config: {},
  };
}

export function sanitizeContext(context: {[key: string]: any}) {
  const sanitizedContext: {[key: string]: boolean } = {};
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
