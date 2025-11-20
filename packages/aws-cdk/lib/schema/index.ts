/**
 * CDK Configuration Schema
 * 
 * This module exports the JSON Schema for cdk.json configuration files
 * for use by external tooling.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * The JSON Schema for CDK configuration files
 */
export const cdkConfigSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'cdk-config.schema.json'), 'utf8')
);