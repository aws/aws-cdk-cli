import * as fs from 'fs';
import * as path from 'path';
import * as tjs from 'typescript-json-schema';
import { SCHEMA_DIR, getGeneratedSchemaPaths, getSchemaDefinition } from './schema-definition';
import { exec, log } from './util';

export function schemasChanged(latestTag: string): boolean {
  const changes = exec(['git', 'diff', '--name-only', latestTag]).split('\n');
  return changes.filter((change) => getGeneratedSchemaPaths().includes(change)).length > 0;
}

/**
 * Generates a schema from typescript types.
 * @returns JSON schema
 * @param schemaName the schema to generate
 */
export function generateSchema(schemaName: string) {
  const spec = getSchemaDefinition(schemaName);
  const out = path.join(SCHEMA_DIR, `${schemaName}.schema.json`);

  const settings: Partial<tjs.Args> = {
    required: true,
    ref: true,
    topRef: true,
    noExtraProps: false,
    out,
  };

  const compilerOptions = {
    strictNullChecks: true,
  };

  const program = tjs.getProgramFromFiles([spec.sourceFile], compilerOptions);
  const schema = tjs.generateSchema(program, spec.rootTypeName, settings);

  augmentDescription(schema);
  addAnyMetadataEntry(schema);

  log(`Generating schema to ${out}`);
  fs.writeFileSync(out, JSON.stringify(schema, null, 4));

  return schema;
}

/**
 * Remove 'default' from the schema since its generated
 * from the tsdocs, which are not necessarily actual values,
 * but rather descriptive behavior.
 *
 * To keep this inforamtion in the schema, we append it to the
 * 'description' of the property.
 */
function augmentDescription(schema: any) {
  function _recurse(o: any) {
    for (const prop in o) {
      if (prop === 'description' && typeof o[prop] === 'string') {
        const description = o[prop];
        const defaultValue = o.default;

        if (!defaultValue) {
          // property doesn't have a default value
          // skip
          continue;
        }

        const descriptionWithDefault = `${description} (Default ${defaultValue})`;

        delete o.default;
        o[prop] = descriptionWithDefault;
      } else if (typeof o[prop] === 'object') {
        _recurse(o[prop]);
      }
    }
  }

  _recurse(schema);
}

/**
 * Patch the properties of MetadataEntry to allow
 * specifying any free form data. This is needed since source
 * code doesn't allow this in order to enforce stricter jsii
 * compatibility checks.
 */
function addAnyMetadataEntry(schema: any) {
  schema?.definitions?.MetadataEntry?.properties.data.anyOf.push({
    description: 'Free form data.',
  });
}
