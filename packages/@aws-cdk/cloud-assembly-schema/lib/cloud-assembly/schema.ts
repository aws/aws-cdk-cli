import type { ArtifactProperties } from './artifact-schema';
import type { ContextProvider, ContextQueryProperties } from './context-queries';
import type { MetadataEntry } from './metadata-schema';

/**
 * Type of cloud artifact.
 */
export enum ArtifactType {
  /**
   * Stub required because of JSII.
   */
  NONE = 'none', // required due to a jsii bug

  /**
   * The artifact is an AWS CloudFormation stack.
   */
  AWS_CLOUDFORMATION_STACK = 'aws:cloudformation:stack',

  /**
   * The artifact contains the CDK application's construct tree.
   */
  CDK_TREE = 'cdk:tree',

  /**
   * Manifest for all assets in the Cloud Assembly
   */
  ASSET_MANIFEST = 'cdk:asset-manifest',

  /**
   * Nested Cloud Assembly
   */
  NESTED_CLOUD_ASSEMBLY = 'cdk:cloud-assembly',

  /**
   * Feature flag report
   */
  FEATURE_FLAG_REPORT = 'cdk:feature-flag-report',
}

/**
 * Information about the application's runtime components.
 */
export interface RuntimeInfo {
  /**
   * The list of libraries loaded in the application, associated with their versions.
   */
  readonly libraries: { [name: string]: string };
}

/**
 * Represents a missing piece of context.
 */
export interface MissingContext {
  /**
   * The missing context key.
   */
  readonly key: string;

  /**
   * The provider from which we expect this context key to be obtained.
   */
  readonly provider: ContextProvider;

  /**
   * A set of provider-specific options.
   */
  readonly props: ContextQueryProperties;
}

/**
 * A manifest for a single artifact within the cloud assembly.
 */
export interface ArtifactManifest {
  /**
   * The type of artifact.
   */
  readonly type: ArtifactType;

  /**
   * The environment into which this artifact is deployed.
   *
   * @default - no envrionment.
   */
  readonly environment?: string; // format: aws://account/region

  /**
   * Associated metadata.
   *
   * Metadata can be stored directly in the assembly manifest, as well as in a
   * separate file (see `additionalMetadataFile`). It should prefer to be stored
   * in the additional file, as that will reduce the size of the assembly
   * manifest in cases of a lot of metdata (which CDK does emit by default).
   *
   * @default - no metadata.
   */
  readonly metadata?: { [path: string]: MetadataEntry[] };

  /**
   * A file with additional metadata entries.
   *
   * The schema of this file is exactly the same as the type of the `metadata` field.
   * In other words, that file contains an object mapping construct paths to arrays
   * of metadata entries.
   *
   * @default - no additional metadata
   */
  readonly additionalMetadataFile?: string;

  /**
   * IDs of artifacts that must be deployed before this artifact.
   *
   * @default - no dependencies.
   */
  readonly dependencies?: string[];

  /**
   * The set of properties for this artifact (depends on type)
   *
   * @default - no properties.
   */
  readonly properties?: ArtifactProperties;

  /**
   * A string that can be shown to a user to uniquely identify this artifact inside a cloud assembly tree
   *
   * Is used by the CLI to present a list of stacks to the user in a way that
   * makes sense to them. Even though the property name "display name" doesn't
   * imply it, this field is used to select stacks as well, so all stacks should
   * have a unique display name.
   *
   * @default - no display name
   */
  readonly displayName?: string;
}

/**
 * A manifest which describes the cloud assembly.
 */
export interface AssemblyManifest {
  /**
   * Protocol version
   */
  readonly version: string;

  /**
   * Required CLI version, if available
   *
   * If the manifest producer knows, it can put the minimum version of the CLI
   * here that supports reading this assembly.
   *
   * If set, it can be used to show a more informative error message to users.
   *
   * @default - Minimum CLI version unknown
   */
  readonly minimumCliVersion?: string;

  /**
   * The set of artifacts in this assembly.
   *
   * @default - no artifacts.
   */
  readonly artifacts?: { [id: string]: ArtifactManifest };

  /**
   * Missing context information. If this field has values, it means that the
   * cloud assembly is not complete and should not be deployed.
   *
   * @default - no missing context.
   */
  readonly missing?: MissingContext[];

  /**
   * Runtime information.
   *
   * @default - no info.
   */
  readonly runtime?: RuntimeInfo;
}
