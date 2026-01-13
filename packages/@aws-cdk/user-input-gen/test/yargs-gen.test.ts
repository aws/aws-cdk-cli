import { $E, expr, ThingSymbol } from '@cdklabs/typewriter';
import type { CliConfig } from '../lib';
import { CliHelpers, renderYargs } from '../lib';

const YARGS_HELPERS = new CliHelpers('./util/yargs-helpers');

describe('render', () => {
  test('can generate global options', async () => {
    const config: CliConfig = {
      globalOptions: {
        one: {
          type: 'string',
          alias: 'o',
          desc: 'text for one',
          requiresArg: true,
        },
        two: { type: 'number', desc: 'text for two' },
        three: {
          type: 'array',
          alias: 't',
          desc: 'text for three',
        },
      },
      commands: {},
    };

    expect(await renderYargs(config, YARGS_HELPERS)).toMatchSnapshot();
  });

  test('can generate negativeAlias', async () => {
    const config: CliConfig = {
      globalOptions: {},
      commands: {
        test: {
          description: 'the action under test',
          aliases: ['spec'],
          options: {
            one: {
              type: 'boolean',
              alias: 'o',
              desc: 'text for one',
              negativeAlias: 'O',
            },
          },
        },
      },
    };

    expect(await renderYargs(config, YARGS_HELPERS)).toMatchSnapshot();
  });

  test('can pass-through expression unchanged', async () => {
    const config: CliConfig = {
      globalOptions: {},
      commands: {
        test: {
          description: 'the action under test',
          options: {
            one: {
              type: 'boolean',
              default: $E(
                expr.sym(new ThingSymbol('banana', YARGS_HELPERS)).call(expr.lit(1), expr.lit(2), expr.lit(3)),
              ),
            },
          },
        },
      },
    };

    expect(await renderYargs(config, YARGS_HELPERS)).toContain('default: helpers.banana(1, 2, 3)');
  });

  test('special notification-arn option gets NO default value', async () => {
    const config: CliConfig = {
      commands: {
        deploy: {
          description: 'Notification Arns',
          options: {
            ['notification-arns']: {
              type: 'array',
              desc: 'Deploy all stacks',
            },
            ['other-array']: {
              type: 'array',
              desc: 'Other array',
            },
          },
        },
      },
      globalOptions: {},
    };

    expect(await renderYargs(config, YARGS_HELPERS)).toMatchSnapshot();
  });
});
