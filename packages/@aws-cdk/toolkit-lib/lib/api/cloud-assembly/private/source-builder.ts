import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import type { AssemblyDirectoryProps, AssemblySourceProps, ICloudAssemblySource } from '../';
import type { ContextAwareCloudAssemblyProps } from './context-aware-source';
import { ContextAwareCloudAssemblySource } from './context-aware-source';
import { execInChildProcess } from './exec';
import { ExecutionEnvironment, assemblyFromDirectory } from './prepare-source';
import type { ToolkitServices } from '../../../toolkit/private';
import { IO } from '../../io/private';
import { Context, RWLock, Settings } from '../../shared-private';
import { ToolkitError, AssemblyError } from '../../shared-public';
import type { AssemblyBuilder } from '../source-builder';
import { ReadableCloudAssembly } from './readable-assembly';

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
   * A temporary output directory will be created if no output directory is
   * explicitly given. This directory will be cleaned up if synthesis fails, or
   * when the Cloud Assembly produced by this source is disposed.
   *
   * A write lock will be acquired on the output directory for the duration of
   * the CDK app synthesis (which means that no two apps can synthesize at the
   * same time), and after synthesis a read lock will be acquired on the
   * directory. This means that while the CloudAssembly is being used, no CDK
   * app synthesis can take place into that directory.
   *
   * @param builder the builder function
   * @param props additional configuration properties
   * @returns the CloudAssembly source
   */
  public async fromAssemblyBuilder(
    builder: AssemblyBuilder,
    props: AssemblySourceProps = {},
  ): Promise<ICloudAssemblySource> {
    const services = await this.sourceBuilderServices();
    const context = new Context({ bag: new Settings(props.context ?? {}) });
    const contextAssemblyProps: ContextAwareCloudAssemblyProps = {
      services,
      context,
      lookups: props.lookups,
    };

    return new ContextAwareCloudAssemblySource(
      {
        produce: async () => {
          await using execution = await ExecutionEnvironment.create(services, { outdir: props.outdir });

          const env = await execution.defaultEnvVars();
          const assembly = await execution.changeDir(async () =>
            execution.withContext(context.all, env, props.synthOptions ?? {}, async (envWithContext, ctx) =>
              execution.withEnv(envWithContext, () => {
                try {
                  return builder({
                    outdir: execution.outdir,
                    context: ctx,
                  });
                } catch (error: unknown) {
                  // re-throw toolkit errors unchanged
                  if (ToolkitError.isToolkitError(error)) {
                    throw error;
                  }
                  // otherwise, wrap into an assembly error
                  throw AssemblyError.withCause('Assembly builder failed', error);
                }
              }),
            ), props.workingDirectory);

          // Convert what we got to the definitely correct type we're expecting, a cxapi.CloudAssembly
          const asm = cxapi.CloudAssembly.isCloudAssembly(assembly)
            ? assembly
            : await assemblyFromDirectory(assembly.directory, services.ioHelper, props.loadAssemblyOptions);

          const success = await execution.markSuccessful();
          return new ReadableCloudAssembly(asm, success.readLock, { deleteOnDispose: execution.outDirIsTemporary });
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
   * @param directory the directory of a already produced Cloud Assembly.
   * @returns the CloudAssembly source
   */
  public async fromAssemblyDirectory(directory: string, props: AssemblyDirectoryProps = {}): Promise<ICloudAssemblySource> {
    const services: ToolkitServices = await this.sourceBuilderServices();
    const contextAssemblyProps: ContextAwareCloudAssemblyProps = {
      services,
      context: new Context(), // @todo there is probably a difference between contextaware and contextlookup sources
      lookups: false,
    };

    return new ContextAwareCloudAssemblySource(
      {
        produce: async () => {
          // @todo build
          await services.ioHelper.notify(IO.CDK_ASSEMBLY_I0150.msg('--app points to a cloud assembly, so we bypass synth'));

          const readLock = await new RWLock(directory).acquireRead();
          const asm = await assemblyFromDirectory(directory, services.ioHelper, props.loadAssemblyOptions);
          return new ReadableCloudAssembly(asm, readLock, { deleteOnDispose: false });
        },
      },
      contextAssemblyProps,
    );
  }
  /**
   * Use a directory containing an AWS CDK app as source.
   *
   * A temporary output directory will be created if no output directory is
   * explicitly given. This directory will be cleaned up if synthesis fails, or
   * when the Cloud Assembly produced by this source is disposed.
   *
   * A write lock will be acquired on the output directory for the duration of
   * the CDK app synthesis (which means that no two apps can synthesize at the
   * same time), and after synthesis a read lock will be acquired on the
   * directory.  This means that while the CloudAssembly is being used, no CDK
   * app synthesis can take place into that directory.
   *
   * @param props additional configuration properties
   * @returns the CloudAssembly source
   */
  public async fromCdkApp(app: string, props: AssemblySourceProps = {}): Promise<ICloudAssemblySource> {
    const services: ToolkitServices = await this.sourceBuilderServices();
    // @todo this definitely needs to read files from the CWD
    const context = new Context({ bag: new Settings(props.context ?? {}) });
    const contextAssemblyProps: ContextAwareCloudAssemblyProps = {
      services,
      context,
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

          const outdir = props.outdir ?? 'cdk.out';
          try {
            fs.mkdirpSync(outdir);
          } catch (e: any) {
            throw new ToolkitError(`Could not create output directory at '${outdir}' (${e.message}).`);
          }

          await using execution = await ExecutionEnvironment.create(services, { outdir });

          const commandLine = await execution.guessExecutable(app);
          const env = await execution.defaultEnvVars();
          return await execution.withContext(context.all, env, props.synthOptions, async (envWithContext, _ctx) => {
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
              extraEnv: envWithContext,
              cwd: props.workingDirectory,
            });

            const asm = await assemblyFromDirectory(outdir, services.ioHelper, props.loadAssemblyOptions);

            const success = await execution.markSuccessful();
            return new ReadableCloudAssembly(asm, success.readLock, { deleteOnDispose: execution.outDirIsTemporary });
          });
        },
      },
      contextAssemblyProps,
    );
  }
}

