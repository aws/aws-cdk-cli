import * as path from 'path';
import { format } from 'util';
import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import { CdkAppMultiContext, MemoryContext, type AssemblyDirectoryProps, type ICloudAssemblySource } from '../';
import type { ContextAwareCloudAssemblyProps } from './context-aware-source';
import { ContextAwareCloudAssemblySource } from './context-aware-source';
import { execInChildProcess } from './exec';
import { ExecutionEnvironment, assemblyFromDirectory, settingsFromSynthOptions, writeContextToEnv } from './prepare-source';
import { ToolkitError, AssemblyError } from '../../../toolkit/toolkit-error';
import type { AppSynthOptions, AssemblyBuilder, FromAssemblyBuilderOptions, FromCdkAppOptions } from '../source-builder';
import { ReadableCloudAssembly } from './readable-assembly';
import type { ToolkitServices } from '../../../toolkit/private';
import { IO } from '../../io/private';
import { RWLock } from '../../rwlock';
import { synthParametersFromSettings } from '../environment';

export abstract class CloudAssemblySourceBuilder {
  /**
   * Helper to provide the CloudAssemblySourceBuilder with required toolkit services
   * @internal
   * @deprecated this should move to the toolkit really.
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
    const contextAssemblyProps: ContextAwareCloudAssemblyProps = {
      services,
      contextStore: new MemoryContext(), // FIXME: We shouldn't be using a `ContextAwareCloudAssemblySource` at all.
      lookups: false,
    };

    return new ContextAwareCloudAssemblySource(
      {
        produce: async () => {
          // @todo build
          await services.ioHelper.notify(IO.CDK_ASSEMBLY_I0150.msg('--app points to a cloud assembly, so we bypass synth'));

          const readLock = await new RWLock(directory).acquireRead();
          try {
            const asm = await assemblyFromDirectory(directory, services.ioHelper, props.loadAssemblyOptions);
            return new ReadableCloudAssembly(asm, readLock, { deleteOnDispose: false });
          } catch (e) {
            await readLock.release();
            throw e;
          }
        },
      },
      contextAssemblyProps,
    );
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
    // @todo this definitely needs to read files from the CWD
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

/**
 * Remove undefined values from a dictionary
 */
function noUndefined<A>(xs: Record<string, A>): Record<string, NonNullable<A>> {
  return Object.fromEntries(Object.entries(xs).filter(([_, v]) => v !== undefined)) as any;
}

/**
 * Turn synthesis options into context/environment variables that will go to the CDK app
 *
 * These are parameters that control the synthesis operation, configurable by the user
 * from the outside of the app.
 */
function parametersFromSynthOptions(synthOptions?: AppSynthOptions) {
  return synthParametersFromSettings(settingsFromSynthOptions(synthOptions ?? {}));
}

/**
 * Temporarily overwrite the `process.env` with a new `env`
 *
 * We make the environment immutable in case there are accidental
 * concurrent accesses.
 */
function temporarilyWriteEnv(env: Record<string, string>) {
  const oldEnv = process.env;

  process.env = detectSynthvarConflicts({
    ...process.env,
    ...env,
  });

  return {
    [Symbol.dispose]() {
      process.env = oldEnv;
    },
  };
}

/**
 * Return an environment-like object that throws if certain keys are set
 *
 * We only throw on specific environment variables to catch the case of
 * concurrent synths. We can't do all variables because there are some
 * routines somewhere that modify things like `JSII_DEPRECATED` globally.
 */
function detectSynthvarConflicts<A extends object>(obj: A) {
  return new Proxy(obj, {
    get(target, prop) {
      return (target as any)[prop];
    },
    set(target, prop, value) {
      if (['CDK_CONTEXT', 'CDK_OUTDIR'].includes(String(prop))) {
        throw new ToolkitError('process.env is temporarily immutable. Set \'clobberEnv: false\' if you want to run multiple \'fromAssemblyBuilder\' synths concurrently');
      }
      (target as any)[prop] = value;
      return true;
    },
  });
}
