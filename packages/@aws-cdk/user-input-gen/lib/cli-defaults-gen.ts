import { Expression, Module, SelectiveModuleImport, TypeScriptRenderer, code } from '@cdklabs/typewriter';
import { EsLintRules } from '@cdklabs/typewriter/lib/eslint-rules';
import * as prettier from 'prettier';
import type { CliHelpers } from './cli-helpers';
import { kebabToCamelCase, lit, preamble, SOURCE_OF_TRUTH } from './util';
import type { CliConfig, CliOption, YargsOption } from './yargs-types';

// to import lodash.clonedeep properly, we would need to set esModuleInterop: true
// however that setting does not work in the CLI, so we fudge it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cloneDeep = require('lodash.clonedeep');

export async function renderCliDefaults(config: CliConfig, helpers: CliHelpers): Promise<string> {
  const scope = new Module('aws-cdk');
  scope.documentation.push(...preamble(SOURCE_OF_TRUTH));

  scope.addImport(new SelectiveModuleImport(scope, '../api/settings', ['Settings']));
  helpers.import(scope, 'helpers');

  scope.addInitialization(
    code.stmt.constVar(
      code.expr.ident('defaultConfig'),
      makeCliDefaults(config),
    ),
    code.stmt.expr(
      code.expr.directCode('export const CLI_DEFAULTS = new Settings(defaultConfig)'),
    ),
  );

  const ts = new TypeScriptRenderer({
    disabledEsLintRules: [
      EsLintRules.MAX_LEN, // the default disabled rules result in 'Definition for rule 'prettier/prettier' was not found
      '@typescript-eslint/consistent-type-imports', // (ironically) typewriter does not support type imports
      '@stylistic/quote-props',
    ],
  }).render(scope);

  return prettier.format(ts, {
    parser: 'typescript',
    printWidth: 150,
    singleQuote: true,
    trailingComma: 'all',
  });
}

function makeCliDefaults(config: CliConfig): Expression {
  return code.expr.object(
    // we must compute global options first, as they are not part of an argument to a command call
    makeDefaultsFromConfig(config.globalOptions),
    Object.entries(config.commands).reduce(
      (commandDefaults, [command, commandConfig]) => {
        const proposedDefaults = makeDefaultsFromConfig(commandConfig.options);
        if (!Object.keys(proposedDefaults).length) {
          return commandDefaults;
        }

        return {
          ...commandDefaults,
          [command]: code.expr.object(makeDefaultsFromConfig(commandConfig.options)),
        };
      }, {},
    ),
  );
}

function makeDefaultsFromConfig(options: { [optionName: string]: CliOption } = {}): Record<string, Expression> {
  const theDefaults: Record<string, Expression> = {};
  for (const option of Object.keys(options)) {
    const optionProps: YargsOption = cloneDeep(options[option]);
    if (optionProps.default == null) {
      continue;
    }

    const camelOption = kebabToCamelCase(option);
    if (optionProps.default instanceof Expression) {
      theDefaults[camelOption] = optionProps.default;
    } else {
      theDefaults[camelOption] = lit(optionProps.default);
    }
  }

  return theDefaults;
}
