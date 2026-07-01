import * as fs_path from 'path';
import * as fs from 'fs-extra';
import type { IoHelper } from '../api-private';

/**
 * Validates a cdk.json configuration object against the generated JSON Schema.
 * Emits warnings via IoHelper -- never blocks or throws.
 */
export async function validateConfigurationFile(config: Record<string, any>, ioHelper: IoHelper): Promise<void> {
  let schema: any;
  try {
    const schemaPath = fs_path.join(__dirname, '..', '..', 'schema', 'cdk-config.schema.json');
    if (!await fs.pathExists(schemaPath)) {
      return; // Schema not available (e.g. development), skip validation
    }
    schema = await fs.readJson(schemaPath);
  } catch {
    return; // Can't load schema, skip validation silently
  }

  const warnings: string[] = [];
  validateObject(config, schema, '', warnings);

  for (const warning of warnings) {
    try {
      await ioHelper.defaults.warning(warning);
    } catch {
      // Never let downstream handlers break config loading
    }
  }
}

function validateObject(data: Record<string, any>, schema: any, path: string, warnings: string[]): void {
  if (!schema.properties) {
    return;
  }

  for (const [key, value] of Object.entries(data)) {
    if (key === 'context' || key === 'custom') {
      continue; // These accept arbitrary values
    }

    const fullPath = path ? `${path}.${key}` : key;
    const propSchema = schema.properties[key];

    if (!propSchema) {
      // Unknown key -- only warn if additionalProperties is false
      if (schema.additionalProperties === false) {
        warnings.push(`Unknown configuration key "${fullPath}" in cdk.json.`);
      } else if (!path) {
        // At root level, warn with a suggestion
        warnings.push(`Unknown configuration key "${fullPath}" in cdk.json. Use the "context" key for custom values.`);
      }
      continue;
    }

    // Type check
    const typeWarning = checkType(fullPath, value, propSchema);
    if (typeWarning) {
      warnings.push(typeWarning);
      continue; // Don't recurse into wrongly-typed values
    }

    // Recurse into nested objects (command config blocks)
    if (propSchema.type === 'object' && propSchema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      validateObject(value, propSchema, fullPath, warnings);
    }
  }
}

function checkType(key: string, value: any, propSchema: any): string | undefined {
  if (propSchema.type === undefined) {
    return undefined;
  }

  const actualType = Array.isArray(value) ? 'array' : typeof value;
  const expectedType = propSchema.type;

  if (actualType === expectedType) {
    return undefined;
  }

  // Objects are valid for object-typed schemas
  if (expectedType === 'object' && actualType === 'object') {
    return undefined;
  }

  return `Configuration key "${key}" has type "${actualType}" but expected "${expectedType}".`;
}
