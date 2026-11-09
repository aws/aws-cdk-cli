import * as path from 'path';
import { format } from 'util';
import * as cxapi from '@aws-cdk/cloud-assembly-api';
import type * as cxschema from '@aws-cdk/cloud-assembly-schema';
import * as fs from 'fs-extra';
import { CdkAppMultiContext, MemoryContext, type IContextStore } from './context-store';
import { RWLock } from '../rwlock';
import { CachedCloudAssembly } from './cached-source';
import { Settings } from '../settings';
import { synthParametersFromSettings, type SynthParameters } from './environment';
import type { ContextAwareCloudAssemblyProps } from './private/context-aware-source';
import { ContextAwareCloudAssemblySource } from './private/context-aware-source';
import { execInChildProcess } from './private/exec';
import { missingContextKeys, temporarilyWriteEnv } from './private/helpers';
import { ExecutionEnvironment, assemblyFromDirectory, parametersFromSynthOptions, settingsFromSynthOptions, writeContextToEnv } from './private/prepare-source';
import { ReadableCloudAssembly } from './private/readable-assembly';
import type { ICloudAssemblySource } from './types';
import type { ToolkitServices } from '../../toolkit/private';
import { ToolkitError, AssemblyError } from '../../toolkit/toolkit-error';
import { noUndefined } from '../../util';
import { IO, type IoHelper } from '../io/private';

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

  /**
   * Signal to indicate that the app building should be stopped.
   *
   * If the App Builder implementation contains a loop or long-running operation, it should
   * add code to check the abort signal and terminate the operation if it has been triggered.
   *
   * The recommended way of handling this signal is to periodically check `abort?.aborted`
   * within long-running loops or operations and throw an exception if you find it to be `true`.
   * You may also just return early; if the abort signal has been triggered but no exception
   * has been thrown yet `fromAssemblyBuilder()` will throw the exception instead; in that
   * case the exception thrown will be a `DOMException` with `e.name == "AbortError"`.
   *
   * It is the AssemblyBuilder implementor's responsibility to respect this signal;
   * the toolkit will not enforce it and won't magically return the control flow
   * while the builder is still running.
   */
  readonly abort?: AbortSignal;
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

  /**
   * Resolve the current default environment an provide as environment variables to the app.
   *
   * This will make a (cached) call to STS to resolve the current account using
   * base credentials. The behavior is not always desirable and can add
   * unnecessary delays, e.g. when an app specifies an environment explicitly
   * or when local actions are be performed without internet access.
   *
   * @default true
   */
  readonly resolveDefaultEnvironment?: boolean;
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
 * Options for the `fromCdkAppDirectory` Assembly Source constructor
 */
export interface FromCdkAppDirectoryOptions {
  /**
   * Perform context lookups.
   *
   * Synthesis fails if this is disabled and context lookups need to be performed.
   *
   * @default true
   */
  readonly lookups?: boolean;

  /**
   * Options that are passed through the context to a CDK app on synth
   *
   * These default to whatever is configured in `cdk.json`, and can be overridden here.
   *
   * @default - settinsgs read from `cdk.json`
   */
  readonly synthOptions?: AppSynthOptions;

  /**
   * Options to configure loading of the assembly after it has been synthesized
   *
   * @default - default assembly loading options
   */
  readonly loadAssemblyOptions?: LoadAssemblyOptions;

  /**
   * Resolve the current default environment an provide as environment variables to the app.
   *
   * This will make a (cached) call to STS to resolve the current account using
   * base credentials. The behavior is not always desirable and can add
   * unnecessary delays, e.g. when an app specifies an environment explicitly
   * or when local actions are be performed without internet access.
   *
   * @default true
   */
  readonly resolveDefaultEnvironment?: boolean;
  /**
   * Additional environment variables
   *
   * These environment variables will be set in addition to the environment
   * variables currently set in the process. A value of `undefined` will
   * unset a particular environment variable.
   *
   * @default - no additional environment variables are set (beyond those
   * already set in the process).
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

  /**
   * Validate stacks during synthesis.
   *
   * When disabled, sets the `CDK_VALIDATION` environment variable to `false` in
   * the app process, so framework-side validation layers (including the built-in
   * CloudFormation template validation) are skipped. This is the value backing
   * the CLI's `--no-validation` option.
   *
   * @default true
   */
  readonly validation?: boolean;
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
    const synthParams = parametersFromSynthOptions(props.synthOptions);

    return this.makeContextAwareCloudAssemblySource({
      contextStore: props.contextStore ?? new MemoryContext(),
      lookups: props.lookups,
      outdir: props.outdir ? path.resolve(props.outdir) : undefined,
      resolveDefaultEnvironment: props.resolveDefaultEnvironment,
      synthParameters: synthParams,
      baseEnv: {},
      disposeOutdir: props.disposeOutdir,
      performSynth: async ({ execution, fullContext, env, abort, ioHelper }) => {
        using _cleanupEnv = (props.clobberEnv ?? true) ? temporarilyWriteEnv(env) : undefined;
        let assembly;
        try {
          assembly = await builder({
            outdir: execution.outdir,
            context: fullContext,
            env,
            abort,
          });

          abort?.throwIfAborted();
        } catch (error: unknown) {
          // Re-throw abort error unchanged
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw error;
          }

          // re-throw toolkit errors unchanged
          if (ToolkitError.isToolkitError(error)) {
            throw error;
          }
          // otherwise, wrap into an assembly error
          throw AssemblyError.withCause('Assembly builder failed', error);
        }

        // Convert what we got to the definitely correct type we're expecting, a cxapi.CloudAssembly
        return cxapi.CloudAssembly.isCloudAssembly(assembly)
          ? assembly
          : await assemblyFromDirectory(assembly.directory, ioHelper, props.loadAssemblyOptions);
      },
    });
  }

  /**
   * Creates a Cloud Assembly from an existing assembly directory.
   *
   * A read lock will be acquired for the directory. This means that while
   * the CloudAssembly is being used, no CDK app synthesis can take place into
   * that directory.
   *
   * @remarks
   * A Cloud Assembly is a trust boundary. Do not deploy Cloud Assemblies
   * from sources you do not trust. Building assets from an external directory
   * can run external code. The author who synthesized the Cloud Assembly, or
   * anyone who can modify it between synthesis and deployment, can affect what
   * code runs on your shell environment, as well as what resources are deployed
   * using your AWS credentials.
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
   * Use an AWS CDK app exectuable as source.
   *
   * `app` is a command line that will be executed to produce a Cloud Assembly.
   * The command will be executed in a shell, so it must come from a trusted source.
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
    const workingDirectory = props.workingDirectory ?? process.cwd();
    const synthParams = parametersFromSynthOptions(props.synthOptions);

    return this.makeContextAwareCloudAssemblySource({
      outdir: props.outdir ? path.resolve(props.outdir) : path.resolve(workingDirectory, 'cdk.out'),
      contextStore: props.contextStore ?? new CdkAppMultiContext(workingDirectory),
      lookups: props.lookups,
      resolveDefaultEnvironment: props.resolveDefaultEnvironment,
      synthParameters: synthParams,
      baseEnv: {
        // Need to start with full env of `writeContextToEnv` will not be able to do the size
        // calculation correctly.
        ...process.env,
        // User gave us something
        ...props.env,
      },
      disposeOutdir: props.disposeOutdir,
      performSynth: performSynthByCallingSubprocess(app, workingDirectory, props.loadAssemblyOptions),
    });
  }

  /**
   * Use an AWS CDK app directory as the source for the Cloud Assembly, same as the CDK CLI
   *
   * This requires and reads the `cdk.json` file the application directory to find the
   * `app` and `outdir` configurations, and loads context from `cdk.json`+`cdk.context.json`,
   * writing context updates to `cdk.context.json`.
   *
   * @param props - additional configuration properties
   * @returns the CloudAssembly source
   */
  public async fromCdkAppDirectory(appDirectory: string, props: FromCdkAppDirectoryOptions = {}): Promise<ICloudAssemblySource> {
    const cdkJsonPath = path.join(appDirectory, 'cdk.json');

    let cdkJsonSettings: Settings;
    try {
      const cdkJson = JSON.parse(await fs.promises.readFile(cdkJsonPath, 'utf-8'));
      cdkJsonSettings = new Settings(cdkJson);
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        throw ToolkitError.withCause('CdkJsonMissing', `fromCdkAppDirectory: cdk.json not found at ${cdkJsonPath}`, e);
      }
      throw ToolkitError.withCause('CdkJsonInvalid', `fromCdkAppDirectory: error reading ${cdkJsonPath}`, e);
    }

    const app = cdkJsonSettings.get(['app']);
    if (!app) {
      throw new ToolkitError('CdkJsonIncomplete', `fromCdkAppDirectory: missing "app" field in ${cdkJsonPath}`);
    }
    const output = cdkJsonSettings.get(['output']);
    const outdir = path.resolve(appDirectory, output ?? 'cdk.out');

    // Combine settings from cdk.json and the ones we received from the synth options (mimicking CLI command-line overrides)
    const mergedSettings = cdkJsonSettings.merge(settingsFromSynthOptions(props.synthOptions, 'onlyThese'));
    const synthParameters = synthParametersFromSettings(mergedSettings);

    return this.makeContextAwareCloudAssemblySource({
      outdir,
      contextStore: new CdkAppMultiContext(appDirectory),
      lookups: props.lookups,
      resolveDefaultEnvironment: props.resolveDefaultEnvironment,
      synthParameters,
      baseEnv: {
        // Need to start with full env of `writeContextToEnv` will not be able to do the size
        // calculation correctly.
        ...process.env,
        // User gave us something
        ...props.env,
      },
      disposeOutdir: false,
      performSynth: performSynthByCallingSubprocess(app, appDirectory, props.loadAssemblyOptions),
    });
  }

  /**
   * Pull together the shared logic for synthesizing a Cloud Assembly from various settings.
   *
   * This method consolidates the common that otherwise go into `fromAssemblyBuilder`, `fromCdkApp`, and `fromCdkAppDirectory`,
   * parameterized by their tiny differences.
   */
  private async makeContextAwareCloudAssemblySource(options: ContextAwareCloudAssemblySourceOptions): Promise<ICloudAssemblySource> {
    const services = await this.sourceBuilderServices();
    const outdir = options.outdir;
    const contextStore = options.contextStore;
    const contextAssemblyProps: ContextAwareCloudAssemblyProps = {
      services,
      contextStore,
      lookups: options.lookups,
    };

    return new ContextAwareCloudAssemblySource(
      {
        produce: async (produceOptions) => {
          await using execution = await ExecutionEnvironment.create(services, {
            outdir,
            resolveDefaultAppEnv: options.resolveDefaultEnvironment ?? true,
          });

          const fullContext = {
            ...await contextStore.read(),
            ...options.synthParameters.context,
          };

          await services.ioHelper.defaults.debug(format('context:', fullContext));

          const env = noUndefined({
            ...options.baseEnv,
            // Versioning, outdir, default account and region
            ...await execution.defaultEnvVars(),
            // Environment variables derived from settings
            ...options.synthParameters.env,
          });

          const cleanupContextOverflow = writeContextToEnv(env, fullContext, 'env-is-complete');
          try {
            const asm = await options.performSynth({
              execution,
              fullContext,
              env,
              abort: produceOptions?.abort,
              ioHelper: services.ioHelper,
            });

            const success = await execution.markSuccessful();
            const deleteOnDispose = options.disposeOutdir ?? execution.shouldDisposeOutDir;
            return new ReadableCloudAssembly(asm, success.readLock, { deleteOnDispose });
          } finally {
            await cleanupContextOverflow();
          }
        },
      },
      contextAssemblyProps,
    );
  }
}

interface ContextAwareCloudAssemblySourceOptions {
  readonly outdir: string | undefined;
  readonly contextStore: IContextStore;
  readonly lookups: boolean | undefined;
  readonly resolveDefaultEnvironment: boolean | undefined;
  readonly synthParameters: SynthParameters;
  readonly baseEnv: Record<string, string | undefined>;
  readonly performSynth: (options: InnerSynthOptions) => Promise<cxapi.CloudAssembly>;
  readonly disposeOutdir: boolean | undefined;
}

interface InnerSynthOptions {
  readonly execution: ExecutionEnvironment;
  readonly fullContext: SynthParameters['context'];
  readonly env: Record<string, string>;
  readonly abort: AbortSignal | undefined;
  readonly ioHelper: IoHelper;
}

function performSynthByCallingSubprocess(app: string, workingDirectory: string, loadAssemblyOptions?: LoadAssemblyOptions): ContextAwareCloudAssemblySourceOptions['performSynth'] {
  return async ({ execution, env, abort, ioHelper }) => {
    const commandLine = await execution.guessExecutable(app);

    await execInChildProcess(commandLine, {
      abort,
      eventPublisher: async (type, line) => {
        switch (type) {
          case 'data_stdout':
            await ioHelper.notify(IO.CDK_ASSEMBLY_I1001.msg(line));
            break;
          case 'data_stderr':
            await ioHelper.notify(IO.CDK_ASSEMBLY_E1002.msg(line));
            break;
        }
      },
      env,
      cwd: workingDirectory,
    });
    return assemblyFromDirectory(execution.outdir, ioHelper, loadAssemblyOptions);
  };
}

