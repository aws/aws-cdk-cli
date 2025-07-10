import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SCHEMA_DIR } from './schema-definition';

export function maybeBumpVersion(schemas: Record<string, any>) {
  const $comment = "Do not hold back the version on additions: jsonschema validation of the manifest by the consumer will trigger errors on unexpected fields.";
  const serializedSchema = JSON.stringify(sortJson(schemas), null, 2);

  const versionFile = path.join(SCHEMA_DIR, 'version.json');
  let current: SchemaVersionFile = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  const schemaHash = sha256(serializedSchema);

  if (current.schemaHash !== schemaHash) {
    current = { schemaHash, $comment, revision: current.revision + 1 };
    console.log(`Schemas changed, bumping version to ${current.revision}`);
  }

  fs.writeFileSync(versionFile, JSON.stringify(current, null, 2));
}

function sha256(x: string) {
  const hash = crypto.createHash('sha256');
  hash.update(x);
  return hash.digest('hex');
}

interface SchemaVersionFile {
  revision: number;
  $comment?: string;
  schemaHash: string;
}

function sortJson<A>(x: A): A {
  if (Array.isArray(x)) {
    return x;
  }
  if (typeof x === 'object' && x !== null) {
    const ret: Record<string, any> = {};
    for (const key of Object.keys(x).sort()) {
      ret[key] = sortJson((x as any)[key]);
    }
    return ret as any;
  }
  return x;
}
