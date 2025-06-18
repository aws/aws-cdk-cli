import { CliConfig } from "@aws-cdk/user-input-gen";
import { Command } from "./schema";

/**
 * argv is the output of yargs
 */
export function redactCommmandLineArguments(argv: any, config: CliConfig): Command {
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