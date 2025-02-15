import * as path from 'path';
import { generatedPath, sourcePath } from './util';

export type SchemaDefinition = {
  /**
   * The name of the root type.
   */
  rootTypeName: string;
  /**
   * Files loaded to generate the schema.
   * Should be relative to `cloud-assembly-schema/lib`.
   * Usually this is just the file containing the root type.
   */
  sourceFile: string;
  /**
   * The location of the generated schema.
   */
  generatedFile: string;
};

/**
 * Where schemas are committed.
 */
export const SCHEMA_DIR = path.resolve(__dirname, '../schema');

const SCHEMA_DEFINITIONS: { [schemaName: string]: SchemaDefinition } = {
  assets: {
    rootTypeName: 'AssetManifest',
    sourceFile: sourcePath('assets'),
    generatedFile: generatedPath('assets'),
  },
  'cloud-assembly': {
    rootTypeName: 'AssemblyManifest',
    sourceFile: sourcePath('cloud-assembly'),
    generatedFile: generatedPath('cloud-assembly'),
  },
  integ: {
    rootTypeName: 'IntegManifest',
    sourceFile: sourcePath('integ-tests'),
    generatedFile: generatedPath('integ'),
  },
};

export const SCHEMAS: string[] = Object.keys(SCHEMA_DEFINITIONS);

export function getSchemaDefinition(key: string): SchemaDefinition {
  return SCHEMA_DEFINITIONS[key];
}

export function getGeneratedSchemaPaths(): string[] {
  return Object.values(SCHEMA_DEFINITIONS).map((s) => s.generatedFile);
}
