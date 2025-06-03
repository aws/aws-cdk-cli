import { $E, expr, ThingSymbol } from '@cdklabs/typewriter';
import type { CliConfig } from '../lib';
import { renderCliDefaults } from '../lib';
import { CliHelpers } from '../lib/cli-helpers';

const YARGS_HELPERS = new CliHelpers('./util/yargs-helpers');

describe('render', () => {
  test('can render global defaults', async () => {
    const config: CliConfig = {
      globalOptions: {
        one: {
          type: 'string',
          alias: 'o',
          desc: 'text for one',
          requiresArg: true,
          default: true,
        },
        two: { type: 'number', desc: 'text for two', default: 'other' },
        three: {
          type: 'array',
          alias: 't',
          desc: 'text for three',
        },
        four: { type: 'boolean', desc: 'text for two', default: YARGS_HELPERS.isCI() },
      },
      commands: {},
    };

    expect(await renderCliDefaults(config, YARGS_HELPERS)).toMatchInlineSnapshot(`
      "// -------------------------------------------------------------------------------------------
      // GENERATED FROM packages/aws-cdk/lib/cli/cli-config.ts.
      // Do not edit by hand; all changes will be overwritten at build time from the config file.
      // -------------------------------------------------------------------------------------------
      /* eslint-disable @stylistic/max-len, @typescript-eslint/consistent-type-imports */
      import { Settings } from '@aws-cdk/toolkit-lib/lib/api/settings';
      import * as helpers from './util/yargs-helpers';

      const settings = {
        one: true,
        two: 'other',
        four: helpers.isCI(),
      };
      export const settings;
      "
    `);
  });

  test('can render command defaults', async () => {
    const config: CliConfig = {
      globalOptions: {},
      commands: {
        test: {
          description: 'the action under test',
          options: {
            one: {
              type: 'string',
              alias: 'o',
              desc: 'text for one',
              requiresArg: true,
              default: true,
            },
            two: { type: 'number', desc: 'text for two', default: 'other' },
            three: {
              type: 'array',
              alias: 't',
              desc: 'text for three',
            },
            four: { type: 'boolean', desc: 'text for two', default: YARGS_HELPERS.isCI() },
          },
        },
      },
    };

    expect(await renderCliDefaults(config, YARGS_HELPERS)).toMatchInlineSnapshot(`
      "// -------------------------------------------------------------------------------------------
      // GENERATED FROM packages/aws-cdk/lib/cli/cli-config.ts.
      // Do not edit by hand; all changes will be overwritten at build time from the config file.
      // -------------------------------------------------------------------------------------------
      /* eslint-disable @stylistic/max-len, @typescript-eslint/consistent-type-imports */
      import { Settings } from '@aws-cdk/toolkit-lib/lib/api/settings';
      import * as helpers from './util/yargs-helpers';

      const settings = {
        test: {
          one: true,
          two: 'other',
          four: helpers.isCI(),
        },
      };
      export const settings;
      "
    `);
  });

  test('can pass-through expression', async () => {
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

    expect(await renderCliDefaults(config, YARGS_HELPERS)).toContain('one: helpers.banana(1, 2, 3)');
  });
});
