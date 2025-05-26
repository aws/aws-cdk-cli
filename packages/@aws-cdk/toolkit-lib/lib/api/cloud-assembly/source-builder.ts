import type * as cxschema from '@aws-cdk/cloud-assembly-schema';
import type { IContextStore } from './context-store';

/**
 * Properties the builder function receives.
 */
export interface AssemblyBuilderProps {
  /**
   * The output directory into which to the builder app will emit synthesized artifacts.
   */
  readonly outdir?: string;

  /**
   * The context provided tp the builder app to synthesize the Cloud Assembly, including looked-up context.
   */
  readonly context?: { [key: string]: any };

  /**
   * Additional configuration that would normally be passed to a CDK app using environment variables
   *
   * This contains variables intended for the user portion of a CDK app (notably
   * `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION`), which you can freely read.
   *
   * It also contains variables intended for the CDK Toolkit to communicate with
   * the internals of the construct library, like `CDK_DEBUG` and
   * `CDK_CLI_ASM_VERSION`. Reading these latter variables is possible but not
   * recommended, as their meaning may change without notice.
   */
  readonly env: Record<string, string>;
}

/**
 * A function that takes synthesis parameters and produces a Cloud Assembly
 *
 * Most typically, the properties passed here will be used to construct a
 * `cdk.App`, and the return value is the return value of `app.synth()`.
 */
export type AssemblyBuilder = (props: AssemblyBuilderProps) => Promise<cxschema.ICloudAssembly>;

/**
 * Configuration for creating a CLI from an AWS CDK App directory
 */
export interface AssemblyDirectoryProps {
  /**
   * Options to configure loading of the assembly after it has been synthesized
   */
  readonly loadAssemblyOptions?: LoadAssemblyOptions;
}

/**
 * Configuration for creating a CLI from an AWS CDK App directory
 */
export interface AssemblySourceProps {
  /**
   * Emits the synthesized cloud assembly into the given directory
   *
   * @default "cdk.out"
   */
  readonly outdir?: string;

  /**
   * Perform context lookups.
   *
   * Synthesis fails if this is disabled and context lookups need to be performed.
   *
   * @default true
   */
  readonly lookups?: boolean;

  /**
   * A context store for this operation
   *
   * The context store will be used to source initial context values,
   * and updated values will be stored here.
   *
   * @default - depend on the operation
   */
  readonly contextStore?: IContextStore;

  /**
   * Options that are passed through the context to a CDK app on synth
   */
  readonly synthOptions?: AppSynthOptions;

  /**
   * Options to configure loading of the assembly after it has been synthesized
   */
  readonly loadAssemblyOptions?: LoadAssemblyOptions;

  /**
   * Delete the `outdir` when the assembly is disposed
   *
   * @default - `true` if `outdir` is not given, `false` otherwise
   */
  readonly disposeOutdir?: boolean;
}

/**
 * Options for the `fromAssemblyBuilder` Assembly Source constructor
 */
export interface FromAssemblyBuilderOptions extends AssemblySourceProps {
  /**
   * Mutate current process' environment variables to communicate with CDK app
   *
   * There are a number of environment variables the Toolkit uses to pass
   * information to the CDK app.
   *
   * By default, these environment variables will be written to the current
   * process' global shared environment variables before the builder is invoked,
   * and you don't need to do anything else. However, because this mutates
   * shared state it is not safe to run multiple builders concurrently.
   *
   * Set this to `false` to avoid mutating the shared environment. Instead,
   * you will need to pass the `outdir` and `context` to the `App` constructor
   * directly in your builder, and inspect the `env` map directly
   * for information like the `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION`.
   *
   * ```ts
   * const cx = await toolkit.fromAssemblyBuilder(async (props) => {
   *   // Important: pass on synthesis parameters
   *   const app = new core.App({
   *     outdir: props.outdir,
   *     context: props.context,
   *   });
   *
   *   new MyStack(app, 'MyStack', {
   *     env: {
   *       account: props.env.CDK_DEFAULT_ACCOUNT,
   *       region: props.env.CDK_DEFAULT_REGION,
   *     },
   *   });
   *
   *   // ...
   * }, {
   *   clobberEnv: false,
   * });
   * ```
   *
   * @default true
   */
  readonly clobberEnv?: boolean;
}

/**
 * Options for the `fromCdkApp` Assembly Source constructor
 */
export interface FromCdkAppOptions extends AssemblySourceProps {
  /**
   * Execute the application in this working directory.
   *
   * @default - current working directory
   */
  readonly workingDirectory?: string;

  /**
   * Additional environment variables
   *
   * These environment variables will be set in addition to the environment
   * variables currently set in the process. A value of `undefined` will
   * unset a particular environment variable.
   */
  readonly env?: Record<string, string | undefined>;
}

/**
 * Settings that are passed to a CDK app via the context
 */
export interface AppSynthOptions {
  /**
   * Debug the CDK app.
   * Logs additional information during synthesis, such as creation stack traces of tokens.
   * This also sets the `CDK_DEBUG` env variable and will slow down synthesis.
   *
   * @default false
   */
  readonly debug?: boolean;

  /**
   * Enables the embedding of the "aws:cdk:path" in CloudFormation template metadata.
   *
   * @default true
   */
  readonly pathMetadata?: boolean;

  /**
   * Enable the collection and reporting of version information.
   *
   * @default true
   */
  readonly versionReporting?: boolean;

  /**
   * Whe enabled, `aws:asset:xxx` metadata entries are added to the template.
   *
   * Disabling this can be useful in certain cases like integration tests.
   *
   * @default true
   */
  readonly assetMetadata?: boolean;

  /**
   * Enable asset staging.
   *
   * Disabling asset staging means that copyable assets will not be copied to the
   * output directory and will be referenced with absolute paths.
   *
   * Not copied to the output directory: this is so users can iterate on the
   * Lambda source and run SAM CLI without having to re-run CDK (note: we
   * cannot achieve this for bundled assets, if assets are bundled they
   * will have to re-run CDK CLI to re-bundle updated versions).
   *
   * Absolute path: SAM CLI expects `cwd`-relative paths in a resource's
   * `aws:asset:path` metadata. In order to be predictable, we will always output
   * absolute paths.
   *
   * @default true
   */
  readonly assetStaging?: boolean;

  /**
   * Select which stacks should have asset bundling enabled
   *
   * @default ["**"] - all stacks
   */
  readonly bundlingForStacks?: string;
}

/**
 * Options to configure loading of the assembly after it has been synthesized
 */
export interface LoadAssemblyOptions {
  /**
   * Check the Toolkit supports the Cloud Assembly Schema version
   *
   * When disabled, allows to Toolkit to read a newer cloud assembly than the CX API is designed
   * to support. Your application may not be aware of all features that in use in the Cloud Assembly.
   *
   * @default true
   */
  readonly checkVersion?: boolean;

  /**
   * Validate enums to only have known values
   *
   * When disabled, the Toolkit may read enum values it doesn't know about yet.
   * You will have to make sure to always check the values of enums you encounter in the manifest.
   *
   * @default true
   */
  readonly checkEnums?: boolean;
}
