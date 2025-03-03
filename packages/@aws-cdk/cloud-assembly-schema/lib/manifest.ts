import * as fs from 'fs';
import * as jsonschema from 'jsonschema';
import * as semver from 'semver';
import * as assets from './assets';
import * as assembly from './cloud-assembly';
import * as integ from './integ-tests';

/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */

// this prefix is used by the CLI to identify this specific error.
// in which case we want to instruct the user to upgrade his CLI.
// see exec.ts#createAssembly
export const VERSION_MISMATCH: string = 'Cloud assembly schema version mismatch';

import CLI_VERSION = require('../cli-version.json');
import ASSETS_SCHEMA = require('../schema/assets.schema.json');

import ASSEMBLY_SCHEMA = require('../schema/cloud-assembly.schema.json');

import INTEG_SCHEMA = require('../schema/integ.schema.json');

/**
 * Version is shared for both manifests
 */
import SCHEMA_VERSION = require('../schema/version.json');

/**
 * CLI version is created at build and release time
 *
 * It needs to be .gitignore'd, otherwise the projen 'no uncommitted
 * changes' self-check will fail, which means it needs to be generated
 * at build time if it doesn't already exist.
 */

/**
 * Options for the loadManifest operation
 */
export interface LoadManifestOptions {
  /**
   * Skip the version check
   *
   * This means you may read a newer cloud assembly than the CX API is designed
   * to support, and your application may not be aware of all features that in use
   * in the Cloud Assembly.
   *
   * @default false
   */
  readonly skipVersionCheck?: boolean;

  /**
   * Skip enum checks
   *
   * This means you may read enum values you don't know about yet. Make sure to always
   * check the values of enums you encounter in the manifest.
   *
   * @default false
   */
  readonly skipEnumCheck?: boolean;

  /**
   * Topologically sort all artifacts
   *
   * This parameter is only respected by the constructor of `CloudAssembly`. The
   * property lives here for backwards compatibility reasons.
   *
   * @default true
   */
  readonly topoSort?: boolean;
}

/**
 * Protocol utility class.
 */
export class Manifest {
  /**
   * Validates and saves the cloud assembly manifest to file.
   *
   * @param manifest - manifest.
   * @param filePath - output file path.
   */
  public static saveAssemblyManifest(manifest: assembly.AssemblyManifest, filePath: string) {
    Manifest.saveManifest(manifest, filePath, ASSEMBLY_SCHEMA, Manifest.patchStackTagsOnWrite);
  }

  /**
   * Load and validates the cloud assembly manifest from file.
   *
   * @param filePath - path to the manifest file.
   */
  public static loadAssemblyManifest(
    filePath: string,
    options?: LoadManifestOptions,
  ): assembly.AssemblyManifest {
    return Manifest.loadManifest(filePath, ASSEMBLY_SCHEMA, Manifest.patchStackTagsOnRead, options);
  }

  /**
   * Validates and saves the asset manifest to file.
   *
   * @param manifest - manifest.
   * @param filePath - output file path.
   */
  public static saveAssetManifest(manifest: assets.AssetManifest, filePath: string) {
    Manifest.saveManifest(manifest, filePath, ASSETS_SCHEMA, Manifest.patchStackTagsOnRead);
  }

  /**
   * Load and validates the asset manifest from file.
   *
   * @param filePath - path to the manifest file.
   */
  public static loadAssetManifest(filePath: string): assets.AssetManifest {
    return this.loadManifest(filePath, ASSETS_SCHEMA);
  }

  /**
   * Validates and saves the integ manifest to file.
   *
   * @param manifest - manifest.
   * @param filePath - output file path.
   */
  public static saveIntegManifest(manifest: integ.IntegManifest, filePath: string) {
    Manifest.saveManifest(manifest, filePath, INTEG_SCHEMA);
  }

  /**
   * Load and validates the integ manifest from file.
   *
   * @param filePath - path to the manifest file.
   */
  public static loadIntegManifest(filePath: string): integ.IntegManifest {
    const manifest = this.loadManifest(filePath, INTEG_SCHEMA);

    // Adding typing to `validate()` led to `loadManifest()` to properly infer
    // its return type, which indicated that the return type of this
    // function may be a lie. I could change the schema to make `testCases`
    // optional, but that will bump the major version of this package and I
    // don't want to do that. So instead, just make sure `testCases` is always there.
    return {
      ...manifest,
      testCases: (manifest as any).testCases ?? [],
    };
  }

  /**
   * Fetch the current schema version number.
   */
  public static version(): string {
    return `${SCHEMA_VERSION.revision}.0.0`;
  }

  /**
   * Return the CLI version that supports this Cloud Assembly Schema version
   */
  public static cliVersion(): string | undefined {
    const version = CLI_VERSION.version;
    return version ? version : undefined;
  }

  /**
   * Deprecated
   * @deprecated use `saveAssemblyManifest()`
   */
  public static save(manifest: assembly.AssemblyManifest, filePath: string) {
    return this.saveAssemblyManifest(manifest, filePath);
  }

  /**
   * Deprecated
   * @deprecated use `loadAssemblyManifest()`
   */
  public static load(filePath: string): assembly.AssemblyManifest {
    return this.loadAssemblyManifest(filePath);
  }

  private static validate(
    manifest: any,
    schema: jsonschema.Schema,
    options?: LoadManifestOptions,
  ): asserts manifest is assembly.AssemblyManifest {
    function parseVersion(version: string) {
      const ver = semver.valid(version);
      if (!ver) {
        throw new Error(`Invalid semver string: "${version}"`);
      }
      return ver;
    }

    const maxSupported = semver.major(parseVersion(Manifest.version()));
    const actual = parseVersion(manifest.version);

    // first validate the version should be accepted. all versions within the same minor version are fine
    if (maxSupported < semver.major(actual) && !options?.skipVersionCheck) {
      // If we have a more specific error to throw than the generic one below, make sure to add that info.
      const cliVersion = (manifest as assembly.AssemblyManifest).minimumCliVersion;
      let cliWarning = '';
      if (cliVersion) {
        cliWarning = `. You need at least CLI version ${cliVersion} to read this manifest.`;
      }

      // we use a well known error prefix so that the CLI can identify this specific error
      // and print some more context to the user.
      throw new Error(
        `${VERSION_MISMATCH}: Maximum schema version supported is ${maxSupported}.x.x, but found ${actual}${cliWarning}`,
      );
    }

    // now validate the format is good.
    const validator = new jsonschema.Validator();
    const result = validator.validate(manifest, schema, {
      // does exist but is not in the TypeScript definitions
      nestedErrors: true,

      allowUnknownAttributes: false,
      preValidateProperty: Manifest.validateAssumeRoleAdditionalOptions,
    });

    let errors = result.errors;
    if (options?.skipEnumCheck) {
      // Enum validations aren't useful when
      errors = stripEnumErrors(errors);
    }

    if (errors.length > 0) {
      throw new Error(`Invalid assembly manifest:\n${errors.map((e) => e.stack).join('\n')}`);
    }
  }

  private static saveManifest(
    manifest: any,
    filePath: string,
    schema: jsonschema.Schema,
    preprocess?: (obj: any) => any,
  ) {
    let withVersion = {
      ...manifest,
      version: Manifest.version(),
      minimumCliVersion: Manifest.cliVersion(),
    } satisfies assembly.AssemblyManifest;
    Manifest.validate(withVersion, schema);
    if (preprocess) {
      withVersion = preprocess(withVersion);
    }
    fs.writeFileSync(filePath, JSON.stringify(withVersion, undefined, 2));
  }

  private static loadManifest(
    filePath: string,
    schema: jsonschema.Schema,
    preprocess?: (obj: any) => any,
    options?: LoadManifestOptions,
  ) {
    const contents = fs.readFileSync(filePath, { encoding: 'utf-8' });
    let obj;
    try {
      obj = JSON.parse(contents);
    } catch (e: any) {
      throw new Error(`${e.message}, while parsing ${JSON.stringify(contents)}`);
    }
    if (preprocess) {
      obj = preprocess(obj);
    }
    Manifest.validate(obj, schema, options);
    return obj;
  }

  /**
   * This requires some explaining...
   *
   * We previously used `{ Key, Value }` for the object that represents a stack tag. (Notice the casing)
   * @link https://github.com/aws/aws-cdk/blob/v1.27.0/packages/aws-cdk/lib/api/cxapp/stacks.ts#L427.
   *
   * When that object moved to this package, it had to be JSII compliant, which meant the property
   * names must be `camelCased`, and not `PascalCased`. This meant it no longer matches the structure in the `manifest.json` file.
   * In order to support current manifest files, we have to translate the `PascalCased` representation to the new `camelCased` one.
   *
   * Note that the serialization itself still writes `PascalCased` because it relates to how CloudFormation expects it.
   *
   * Ideally, we would start writing the `camelCased` and translate to how CloudFormation expects it when needed. But this requires nasty
   * backwards-compatibility code and it just doesn't seem to be worth the effort.
   */
  private static patchStackTagsOnRead(this: void, manifest: assembly.AssemblyManifest) {
    return Manifest.replaceStackTags(manifest, (tags) =>
      tags.map((diskTag: any) => ({
        key: diskTag.Key,
        value: diskTag.Value,
      })),
    );
  }

  /**
   * Validates that `assumeRoleAdditionalOptions` doesn't contain nor `ExternalId` neither `RoleArn`, as they
   * should have dedicated properties preceding this (e.g `assumeRoleArn` and `assumeRoleExternalId`).
   */
  private static validateAssumeRoleAdditionalOptions(
    this: void,
    instance: any,
    key: string,
    _schema: jsonschema.Schema,
    _options: jsonschema.Options,
    _ctx: jsonschema.SchemaContext,
  ) {
    if (key !== 'assumeRoleAdditionalOptions') {
      // note that this means that if we happen to have a property named like this, but that
      // does want to allow 'RoleArn' or 'ExternalId', this code will have to change to consider the full schema path.
      // I decided to make this less granular for now on purpose because it fits our needs and avoids having messy
      // validation logic due to various schema paths.
      return;
    }

    const assumeRoleOptions = instance[key];
    if (assumeRoleOptions?.RoleArn) {
      throw new Error(`RoleArn is not allowed inside '${key}'`);
    }
    if (assumeRoleOptions?.ExternalId) {
      throw new Error(`ExternalId is not allowed inside '${key}'`);
    }
  }

  /**
   * See explanation on `patchStackTagsOnRead`
   *
   * Translate stack tags metadata if it has the "right" casing.
   */
  private static patchStackTagsOnWrite(this: void, manifest: assembly.AssemblyManifest) {
    return Manifest.replaceStackTags(manifest, (tags) =>
      tags.map(
        (memTag) =>
          // Might already be uppercased (because stack synthesis generates it in final form yet)
          ('Key' in memTag ? memTag : { Key: memTag.key, Value: memTag.value }) as any,
      ),
    );
  }

  /**
   * Recursively replace stack tags in the stack metadata
   */
  private static replaceStackTags(
    manifest: assembly.AssemblyManifest,
    fn: Endofunctor<assembly.StackTagsMetadataEntry>,
  ): assembly.AssemblyManifest {
    // Need to add in the `noUndefined`s because otherwise jest snapshot tests are going to freak out
    // about the keys with values that are `undefined` (even though they would never be JSON.stringified)
    return noUndefined({
      ...manifest,
      artifacts: mapValues(manifest.artifacts, (artifact) => {
        if (artifact.type !== assembly.ArtifactType.AWS_CLOUDFORMATION_STACK) {
          return artifact;
        }
        return noUndefined({
          ...artifact,
          metadata: mapValues(artifact.metadata, (metadataEntries) =>
            metadataEntries.map((metadataEntry) => {
              if (
                metadataEntry.type !== assembly.ArtifactMetadataEntryType.STACK_TAGS ||
                !metadataEntry.data
              ) {
                return metadataEntry;
              }
              return {
                ...metadataEntry,
                data: fn(metadataEntry.data as assembly.StackTagsMetadataEntry),
              };
            }),
          ),
        } as assembly.ArtifactManifest);
      }),
    });
  }

  private constructor() {
  }
}

type Endofunctor<A> = (x: A) => A;

function mapValues<A, B>(
  xs: Record<string, A> | undefined,
  fn: (x: A) => B,
): Record<string, B> | undefined {
  if (!xs) {
    return undefined;
  }
  const ret: Record<string, B> | undefined = {};
  for (const [k, v] of Object.entries(xs)) {
    ret[k] = fn(v);
  }
  return ret;
}

function noUndefined<A extends object>(xs: A): A {
  const ret: any = {};
  for (const [k, v] of Object.entries(xs)) {
    if (v !== undefined) {
      ret[k] = v;
    }
  }
  return ret;
}

function stripEnumErrors(errors: jsonschema.ValidationError[]) {
  return errors.filter((e) => typeof e.schema === 'string' || !('enum' in e.schema));
}
