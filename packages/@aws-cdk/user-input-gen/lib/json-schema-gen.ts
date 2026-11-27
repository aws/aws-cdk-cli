import { kebabToCamelCase, SOURCE_OF_TRUTH } from './util';
import type { CliConfig, CliOption } from './yargs-types';

interface JsonSchema {
  $schema: string;
  $id: string;
  title: string;
  description: string;
  type: string;
  additionalProperties: boolean;
  properties: Record<string, any>;
  definitions?: Record<string, any>;
}

/**
 * Generate a JSON Schema (draft-07) for cdk.json from the CliConfig source of truth.
 */
export function renderJsonSchema(config: CliConfig): string {
  const schema: JsonSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://cdn.jsdelivr.net/npm/aws-cdk/schema/cdk-config.schema.json',
    title: 'CDK Configuration',
    description: `JSON Schema for cdk.json. Generated from ${SOURCE_OF_TRUTH}. Do not edit by hand.`,
    type: 'object',
    additionalProperties: true,
    properties: {},
  };

  // Global options as top-level properties (sorted for deterministic output)
  // Skip 'context' -- it's special-cased below as an arbitrary KV object
  for (const [optionName, option] of Object.entries(config.globalOptions).sort(([a], [b]) => a.localeCompare(b))) {
    if (optionName === 'context') {
      continue;
    }
    const camelName = kebabToCamelCase(optionName);
    schema.properties[camelName] = optionToSchema(option);
  }

  // Context is a special case: an object with arbitrary key-value pairs.
  // The 'context' command also exists but its options (reset, force, clear) are CLI-only,
  // not settable via cdk.json. The cdk.json 'context' key holds arbitrary context values.
  schema.properties.context = {
    type: 'object',
    description: 'Context values for the CDK app. Keys are context keys, values are context values.',
    additionalProperties: true,
  };

  // Watch is a merged block: file-watching config (include/exclude) PLUS command-level options.
  // In cdk.json, both `watch.include` and `watch.hotswap` are valid at the same level.
  // additionalProperties: true because users may have custom watch patterns beyond include/exclude.
  const watchSchema: any = {
    type: 'object',
    description: 'Configuration for `cdk watch`. Includes file-watching patterns and deployment options.',
    additionalProperties: true,
    properties: {
      include: {
        type: 'array',
        items: { type: 'string' },
        description: 'File glob patterns to include in watch.',
      },
      exclude: {
        type: 'array',
        items: { type: 'string' },
        description: 'File glob patterns to exclude from watch.',
      },
    } as Record<string, any>,
  };

  // Merge watch command options into the watch schema
  const watchCommand = config.commands.watch;
  if (watchCommand?.options) {
    for (const [optName, opt] of Object.entries(watchCommand.options).sort(([a], [b]) => a.localeCompare(b))) {
      watchSchema.properties[kebabToCamelCase(optName)] = optionToSchema(opt);
    }
  }
  schema.properties.watch = watchSchema;

  // Per-command config blocks
  // Skip 'watch' (merged above) and 'context' (arbitrary KV, not command options)
  const SKIP_COMMANDS = new Set(['watch', 'context']);

  for (const [commandName, command] of Object.entries(config.commands)) {
    if (SKIP_COMMANDS.has(commandName)) {
      continue;
    }

    const camelName = kebabToCamelCase(commandName);
    const commandOptions = command.options;

    // Skip commands with no options (nothing configurable via cdk.json)
    if (!commandOptions || Object.keys(commandOptions).length === 0) {
      continue;
    }

    const commandSchema: any = {
      type: 'object',
      description: `Configuration for \`cdk ${commandName}\`. ${command.description}`,
      additionalProperties: false,
      properties: {} as Record<string, any>,
    };

    for (const [optName, opt] of Object.entries(commandOptions).sort(([a], [b]) => a.localeCompare(b))) {
      commandSchema.properties[kebabToCamelCase(optName)] = optionToSchema(opt);
    }

    schema.properties[camelName] = commandSchema;
  }

  return JSON.stringify(schema, null, 2) + '\n';
}

function optionToSchema(option: CliOption): any {
  const prop: any = {};

  // Map type (count overrides to number, matching user-input-gen behavior)
  const effectiveType = option.count ? 'count' : option.type;
  switch (effectiveType) {
    case 'string':
      prop.type = 'string';
      break;
    case 'boolean':
      prop.type = 'boolean';
      break;
    case 'number':
      prop.type = 'number';
      break;
    case 'array':
      prop.type = 'array';
      prop.items = { type: 'string' };
      break;
    case 'count':
      prop.type = 'number';
      break;
    default: {
      // Exhaustive check: if CliOption adds a new type, this will fail at compile time
      const _exhaustive: never = effectiveType;
      throw new Error(`Unhandled option type: ${_exhaustive}`);
    }
  }

  // Description
  if (option.desc) {
    prop.description = option.desc;
    // markdownDescription enables rich hover tooltips in VS Code and JetBrains
    prop.markdownDescription = option.desc;
  }

  // Enum choices (keep type alongside for better IDE autocomplete)
  if (option.choices && option.choices.length > 0) {
    prop.enum = option.choices.filter((c) => c !== undefined);
  }

  // Default value -- only emit primitives and arrays.
  // Object defaults (e.g. deploy.parameters has default: {}) are yargs runtime quirks
  // that don't belong in JSON Schema. Expression defaults (YARGS_HELPERS calls) evaluate
  // to primitives at generation time since makeConfig() is awaited.
  if (option.default !== undefined && typeof option.default !== 'function' && typeof option.default !== 'object') {
    prop.default = option.default;
  } else if (option.default !== undefined && Array.isArray(option.default)) {
    prop.default = option.default;
  }

  // Deprecation marker (text in description only -- 'deprecated' boolean is draft 2019-09,
  // not valid in draft-07. SchemaStore schemas use description-only approach.)
  if (option.deprecated) {
    if (typeof option.deprecated === 'string') {
      const deprecationNote = `Deprecated: ${option.deprecated}`;
      prop.description = prop.description ? `${prop.description}. ${deprecationNote}` : deprecationNote;
      prop.markdownDescription = prop.description;
    } else {
      prop.description = prop.description ? `(Deprecated) ${prop.description}` : 'Deprecated';
      prop.markdownDescription = prop.description;
    }
  }

  return prop;
}
