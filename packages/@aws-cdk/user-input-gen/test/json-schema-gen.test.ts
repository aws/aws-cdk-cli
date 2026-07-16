import { renderJsonSchema } from '../lib/json-schema-gen';
import type { CliConfig } from '../lib/yargs-types';

describe('renderJsonSchema', () => {
  const minimalConfig: CliConfig = {
    globalOptions: {
      app: { type: 'string', desc: 'Command-line for executing your app' },
      debug: { type: 'boolean', desc: 'Debug mode', default: false },
      verbose: { type: 'boolean', desc: 'Verbose output', default: false, count: true },
      context: { type: 'array', desc: 'Context values' },
    },
    commands: {
      deploy: {
        description: 'Deploy stacks',
        options: {
          'require-approval': { type: 'string', choices: ['never', 'any-change', 'broadening'], desc: 'Approval level' },
          'rollback': { type: 'boolean', desc: 'Rollback on failure' },
          'concurrency': { type: 'number', desc: 'Parallel deploys', default: 1 },
          'hotswap': { type: 'boolean', desc: 'Hotswap deploy' },
        },
        arg: { name: 'STACKS', variadic: true },
      },
      watch: {
        description: 'Watch and deploy',
        options: {
          hotswap: { type: 'boolean', desc: 'Hotswap deploy' },
          logs: { type: 'boolean', desc: 'Show logs', default: true },
          concurrency: { type: 'number', desc: 'Parallel deploys', default: 1 },
        },
      },
      context: {
        description: 'Manage context',
        options: {
          reset: { type: 'string', desc: 'Reset context key' },
          clear: { type: 'boolean', desc: 'Clear all', default: false },
        },
      },
      destroy: {
        description: 'Destroy stacks',
        options: {
          force: { type: 'boolean', desc: 'Skip confirmation' },
        },
        arg: { name: 'STACKS', variadic: true },
      },
      doctor: {
        description: 'Check setup',
      },
    },
  };

  let schema: any;

  beforeAll(() => {
    schema = JSON.parse(renderJsonSchema(minimalConfig));
  });

  test('produces valid JSON Schema draft-07', () => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(true);
  });

  test('includes global options as top-level properties', () => {
    expect(schema.properties.app).toEqual({
      type: 'string',
      description: 'Command-line for executing your app',
      markdownDescription: 'Command-line for executing your app',
    });
    expect(schema.properties.debug).toEqual({
      type: 'boolean',
      description: 'Debug mode',
      markdownDescription: 'Debug mode',
      default: false,
    });
  });

  test('converts kebab-case to camelCase', () => {
    expect(schema.properties.app).toBeDefined();
    expect(schema.properties.debug).toBeDefined();
  });

  test('handles count type as number', () => {
    expect(schema.properties.verbose.type).toBe('number');
  });

  test('includes per-command config blocks', () => {
    expect(schema.properties.deploy).toBeDefined();
    expect(schema.properties.deploy.type).toBe('object');
    expect(schema.properties.deploy.properties.requireApproval).toBeDefined();
    expect(schema.properties.deploy.properties.rollback).toBeDefined();
    expect(schema.properties.deploy.properties.concurrency).toBeDefined();
    expect(schema.properties.deploy.properties.hotswap).toBeDefined();
  });

  test('command blocks have additionalProperties: false', () => {
    expect(schema.properties.deploy.additionalProperties).toBe(false);
    expect(schema.properties.destroy.additionalProperties).toBe(false);
  });

  test('skips commands with no options', () => {
    expect(schema.properties.doctor).toBeUndefined();
  });

  test('includes enum choices', () => {
    expect(schema.properties.deploy.properties.requireApproval.enum).toEqual(['never', 'any-change', 'broadening']);
  });

  test('includes default values', () => {
    expect(schema.properties.deploy.properties.concurrency.default).toBe(1);
  });

  test('context is not overwritten by context command', () => {
    expect(schema.properties.context.type).toBe('object');
    expect(schema.properties.context.additionalProperties).toBe(true);
    // Must NOT have reset/clear from the 'context' command
    expect(schema.properties.context.properties).toBeUndefined();
  });

  test('watch merges file-watching and command options', () => {
    expect(schema.properties.watch.type).toBe('object');
    // File-watching properties
    expect(schema.properties.watch.properties.include).toBeDefined();
    expect(schema.properties.watch.properties.exclude).toBeDefined();
    // Command options merged in
    expect(schema.properties.watch.properties.hotswap).toEqual({
      type: 'boolean',
      description: 'Hotswap deploy',
      markdownDescription: 'Hotswap deploy',
    });
    expect(schema.properties.watch.properties.logs).toEqual({
      type: 'boolean',
      description: 'Show logs',
      markdownDescription: 'Show logs',
      default: true,
    });
    expect(schema.properties.watch.properties.concurrency).toEqual({
      type: 'number',
      description: 'Parallel deploys',
      markdownDescription: 'Parallel deploys',
      default: 1,
    });
  });

  test('handles deprecated options via description text', () => {
    const configWithDeprecated: CliConfig = {
      globalOptions: {},
      commands: {
        deploy: {
          description: 'Deploy',
          options: {
            'execute': { type: 'boolean', desc: 'Execute changeset', deprecated: true },
            'old-param': { type: 'string', desc: 'Old param', deprecated: 'use --new-param' },
          },
        },
      },
    };
    const result = JSON.parse(renderJsonSchema(configWithDeprecated));
    // No 'deprecated: true' boolean (non-standard in draft-07)
    expect(result.properties.deploy.properties.execute.deprecated).toBeUndefined();
    expect(result.properties.deploy.properties.execute.description).toContain('Deprecated');
    expect(result.properties.deploy.properties.oldParam.deprecated).toBeUndefined();
    expect(result.properties.deploy.properties.oldParam.description).toContain('use --new-param');
  });

  test('output is valid JSON ending with newline', () => {
    const output = renderJsonSchema(minimalConfig);
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output.endsWith('\n')).toBe(true);
  });
});

describe('renderJsonSchema snapshot', () => {
  test('schema output matches snapshot', () => {
    const config: CliConfig = {
      globalOptions: {
        app: { type: 'string', desc: 'Command-line for executing your app' },
        debug: { type: 'boolean', desc: 'Debug mode', default: false },
        lookups: { type: 'boolean', desc: 'Perform context lookups', default: true },
      },
      commands: {
        deploy: {
          description: 'Deploy stacks',
          options: {
            'require-approval': { type: 'string', choices: ['never', 'any-change', 'broadening'], desc: 'Approval level' },
            'rollback': { type: 'boolean', desc: 'Rollback on failure' },
            'execute': { type: 'boolean', desc: 'Execute change set', deprecated: true },
          },
        },
        watch: {
          description: 'Watch and deploy',
          options: {
            hotswap: { type: 'boolean', desc: 'Hotswap deploy' },
          },
        },
        context: {
          description: 'Manage context',
          options: { clear: { type: 'boolean', desc: 'Clear all' } },
        },
      },
    };
    expect(renderJsonSchema(config)).toMatchSnapshot();
  });
});
