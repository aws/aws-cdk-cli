import * as path from 'path';
import { format } from 'util';
import type * as cxschema from '@aws-cdk/cloud-assembly-schema';
import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import { CdkAppMultiContext, MemoryContext, type IContextStore } from './context-store';
import { RWLock } from '../rwlock';
import { CachedCloudAssembly } from './cached-source';
import type { ContextAwareCloudAssemblyProps } from './private/context-aware-source';
import { ContextAwareCloudAssemblySource } from './private/context-aware-source';
import { execInChildProcess } from './private/exec';
import { ExecutionEnvironment, assemblyFromDirectory, parametersFromSynthOptions, writeContextToEnv } from './private/prepare-source';
import { ReadableCloudAssembly } from './private/readable-assembly';
import type { ICloudAssemblySource } from './types';
import type { ToolkitServices } from '../../toolkit/private';
import { ToolkitError, AssemblyError } from '../../toolkit/toolkit-error';
import { noUndefined } from '../../util';
import { IO } from '../io/private';
import { missingContextKeys, temporarilyWriteEnv } from './private/helpers';

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

  /**
   * Whether or not to fail if the synthesized assembly contains
   * missing context
   *
   * @default true
   */
  readonly failOnMissingContext?: boolean;
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
   * @default - Depends on the operation
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
   * @default - Current working directory
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

export abstract class CloudAssemblySourceBuilder {
  /**
   * Helper to provide the CloudAssemblySourceBuilder with required toolkit services
   * @internal
   */
  protected abstract sourceBuilderServices(): Promise<ToolkitServices>;

  /**
   * Create a Cloud Assembly from a Cloud Assembly builder function.
   *
   * ## Outdir
   *
   * If no output directory is given, it will synthesize into a temporary system
   * directory. The temporary directory will be cleaned up, unless
   * `disposeOutdir: false`.
   *
   * A write lock will be acquired on the output directory for the duration of
   * the CDK app synthesis (which means that no two apps can synthesize at the
   * same time), and after synthesis a read lock will be acquired on the
   * directory. This means that while the CloudAssembly is being used, no CDK
   * app synthesis can take place into that directory.
   *
   * ## Context
   *
   * If no `contextStore` is given, a `MemoryContext` will be used. This means
   * no provider lookups will be persisted anywhere by default. Use a different
   * type of context store if you want persistence between synth operations.
   *
   * @param builder - the builder function
   * @param props - additional configuration properties
   * @returns the CloudAssembly source
   */
  public async fromAssemblyBuilder(
    builder: AssemblyBuilder,
    props: FromAssemblyBuilderOptions = {},
  ): Promise<ICloudAssemblySource> {
    const services = await this.sourceBuilderServices();
    const contextStore = props.contextStore ?? new MemoryContext();
    const contextAssemblyProps: ContextAwareCloudAssemblyProps = {
      services,
      contextStore,
      lookups: props.lookups,
    };

    const outdir = props.outdir ? path.resolve(props.outdir) : undefined;

    return new ContextAwareCloudAssemblySource(
      {
        produce: async () => {
          await using execution = await ExecutionEnvironment.create(services, { outdir });

          const synthParams = parametersFromSynthOptions(props.synthOptions);

          const fullContext = {
            ...await contextStore.read(),
            ...synthParams.context,
          };

          await services.ioHelper.defaults.debug(format('context:', fullContext));

          const env = noUndefined({
            // Versioning, outdir, default account and region
            ...await execution.defaultEnvVars(),
            // Environment variables derived from settings
            ...synthParams.env,
          });

          const cleanupContextTemp = writeContextToEnv(env, fullContext);
          using _cleanupEnv = (props.clobberEnv ?? true) ? temporarilyWriteEnv(env) : undefined;
          let assembly;
          try {
            assembly = await builder({
              outdir: execution.outdir,
              context: fullContext,
              env,
            });
          } catch (error: unknown) {
            // re-throw toolkit errors unchanged
            if (ToolkitError.isToolkitError(error)) {
              throw error;
            }
            // otherwise, wrap into an assembly error
            throw AssemblyError.withCause('Assembly builder failed', error);
          } finally {
            await cleanupContextTemp();
          }

          // Convert what we got to the definitely correct type we're expecting, a cxapi.CloudAssembly
          const asm = cxapi.CloudAssembly.isCloudAssembly(assembly)
            ? assembly
            : await assemblyFromDirectory(assembly.directory, services.ioHelper, props.loadAssemblyOptions);

          const success = await execution.markSuccessful();
          const deleteOnDispose = props.disposeOutdir ?? execution.outDirIsTemporary;
          return new ReadableCloudAssembly(asm, success.readLock, { deleteOnDispose });
        },
      },
      contextAssemblyProps,
    );
  }

  /**
   * Creates a Cloud Assembly from an existing assembly directory.
   *
   * A read lock will be acquired for the directory. This means that while
   * the CloudAssembly is being used, no CDK app synthesis can take place into
   * that directory.
   *
   * @param directory - directory the directory of a already produced Cloud Assembly.
   * @returns the CloudAssembly source
   */
  public async fromAssemblyDirectory(directory: string, props: AssemblyDirectoryProps = {}): Promise<ICloudAssemblySource> {
    const services: ToolkitServices = await this.sourceBuilderServices();

    return {
      async produce() {
        await services.ioHelper.notify(IO.CDK_ASSEMBLY_I0150.msg('--app points to a cloud assembly, so we bypass synth'));
        const readLock = await new RWLock(directory).acquireRead();
        try {
          const asm = await assemblyFromDirectory(directory, services.ioHelper, props.loadAssemblyOptions);
          const assembly = new ReadableCloudAssembly(asm, readLock, { deleteOnDispose: false });
          if (assembly.cloudAssembly.manifest.missing && assembly.cloudAssembly.manifest.missing.length > 0) {
            if (props.failOnMissingContext ?? true) {
              const missingKeysSet = missingContextKeys(assembly.cloudAssembly.manifest.missing);
              const missingKeys = Array.from(missingKeysSet);
              throw AssemblyError.withCause(
                'Assembly contains missing context. ' +
                  "Make sure all necessary context is already in 'cdk.context.json' by running 'cdk synth' on a machine with sufficient AWS credentials and committing the result. " +
                  `Missing context keys: '${missingKeys.join(', ')}'`,
                'Error producing assembly',
              );
            }
          }
          return new CachedCloudAssembly(assembly);
        } catch (e) {
          await readLock.release();
          throw e;
        }
      },
    };
  }
  /**
   * Use a directory containing an AWS CDK app as source.
   *
   * The subprocess will execute in `workingDirectory`, which defaults to
   * the current process' working directory if not given.
   *
   * ## Outdir
   *
   * If an output directory is supplied, relative paths are evaluated with
   * respect to the current process' working directory. If an output directory
   * is not supplied, the default is a `cdk.out` directory underneath
   * `workingDirectory`. The output directory will not be cleaned up unless
   * `disposeOutdir: true`.
   *
   * A write lock will be acquired on the output directory for the duration of
   * the CDK app synthesis (which means that no two apps can synthesize at the
   * same time), and after synthesis a read lock will be acquired on the
   * directory.  This means that while the CloudAssembly is being used, no CDK
   * app synthesis can take place into that directory.
   *
   * ## Context
   *
   * If no `contextStore` is given, a `CdkAppMultiContext` will be used, initialized
   * to the app's `workingDirectory`. This means that context will be loaded from
   * all the CDK's default context sources, and updates will be written to
   * `cdk.context.json`.
   *
   * @param props - additional configuration properties
   * @returns the CloudAssembly source
   */
  public async fromCdkApp(app: string, props: FromCdkAppOptions = {}): Promise<ICloudAssemblySource> {
    const services: ToolkitServices = await this.sourceBuilderServices();
    const workingDirectory = props.workingDirectory ?? process.cwd();
    const outdir = props.outdir ? path.resolve(props.outdir) : path.resolve(workingDirectory, 'cdk.out');

    const contextStore = props.contextStore ?? new CdkAppMultiContext(workingDirectory);

    const contextAssemblyProps: ContextAwareCloudAssemblyProps = {
      services,
      contextStore,
      lookups: props.lookups,
    };

    return new ContextAwareCloudAssemblySource(
      {
        produce: async () => {
          // @todo build
          // const build = this.props.configuration.settings.get(['build']);
          // if (build) {
          //   await execInChildProcess(build, { cwd: props.workingDirectory });
          // }

          try {
            fs.mkdirpSync(outdir);
          } catch (e: any) {
            throw new ToolkitError(`Could not create output directory at '${outdir}' (${e.message}).`);
          }

          await using execution = await ExecutionEnvironment.create(services, { outdir });

          const commandLine = await execution.guessExecutable(app);

          const synthParams = parametersFromSynthOptions(props.synthOptions);

          const fullContext = {
            ...await contextStore.read(),
            ...synthParams.context,
          };

          await services.ioHelper.defaults.debug(format('context:', fullContext));

          const env = noUndefined({
            // Need to start with full env of `writeContextToEnv` will not be able to do the size
            // calculation correctly.
            ...process.env,
            // User gave us something
            ...props.env,
            // Versioning, outdir, default account and region
            ...await execution.defaultEnvVars(),
            // Environment variables derived from settings
            ...synthParams.env,
          });
          const cleanupTemp = writeContextToEnv(env, fullContext);
          try {
            await execInChildProcess(commandLine.join(' '), {
              eventPublisher: async (type, line) => {
                switch (type) {
                  case 'data_stdout':
                    await services.ioHelper.notify(IO.CDK_ASSEMBLY_I1001.msg(line));
                    break;
                  case 'data_stderr':
                    await services.ioHelper.notify(IO.CDK_ASSEMBLY_E1002.msg(line));
                    break;
                }
              },
              env,
              cwd: workingDirectory,
            });
          } finally {
            await cleanupTemp();
          }

          const asm = await assemblyFromDirectory(outdir, services.ioHelper, props.loadAssemblyOptions);

          const success = await execution.markSuccessful();
          const deleteOnDispose = props.disposeOutdir ?? execution.outDirIsTemporary;
          return new ReadableCloudAssembly(asm, success.readLock, { deleteOnDispose });
        },
      },
      contextAssemblyProps,
    );
  }
}

