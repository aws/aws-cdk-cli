import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import { type AssemblyDirectoryProps, type AssemblySourceProps, type ICloudAssemblySource } from '../';
import type { ContextAwareCloudAssemblyProps } from './context-aware-source';
import { ContextAwareCloudAssemblySource } from './context-aware-source';
import { execInChildProcess } from './exec';
import { ExecutionEnvironment, assemblyFromDirectory } from './prepare-source';
import type { ToolkitServices } from '../../../toolkit/private';
import { IO } from '../../io/private';
import { Context, RWLock, Settings } from '../../shared-private';
import { ToolkitError, AssemblyError } from '../../shared-public';
import type { AssemblyBuilder } from '../source-builder';
import { associateLock } from './locking';

export abstract class CloudAssemblySourceBuilder {
  /**
   * Helper to provide the CloudAssemblySourceBuilder with required toolkit services
   * @deprecated this should move to the toolkit really.
   */
  protected abstract sourceBuilderServices(): Promise<ToolkitServices>;

  /**
   * Create a Cloud Assembly from a Cloud Assembly builder function.
   *
   * A write lock will be acquired on the output directory for the duration of
   * the CDK app synthesis (which means that no two apps can synthesize at the
   * same time), and after synthesis a read lock will be acquired on the
   * directory.  This means that while the CloudAssembly is being used, no CDK
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
          const execution = new ExecutionEnvironment(services, { outdir: props.outdir });

          const lock = await new RWLock(execution.outdir).acquireWrite();

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

          const readLock = await lock.convertToReaderLock();

          if (cxapi.CloudAssembly.isCloudAssembly(assembly)) {
            return associateLock(assembly, readLock);
          }

          return assemblyFromDirectory(assembly.directory, services.ioHelper, readLock, props.loadAssemblyOptions);
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
          const readLock = await new RWLock(directory).acquireRead();

          // @todo build
          await services.ioHelper.notify(IO.CDK_ASSEMBLY_I0150.msg('--app points to a cloud assembly, so we bypass synth'));
          return assemblyFromDirectory(directory, services.ioHelper, readLock, props.loadAssemblyOptions);
        },
      },
      contextAssemblyProps,
    );
  }
  /**
   * Use a directory containing an AWS CDK app as source.
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

          const lock = await new RWLock(outdir).acquireWrite();

          const execution = new ExecutionEnvironment(services, { outdir });
          const commandLine = await execution.guessExecutable(app);
          const env = await execution.defaultEnvVars();
          return execution.withContext(context.all, env, props.synthOptions, async (envWithContext, _ctx) => {
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

            const readLock = await lock.convertToReaderLock();

            return assemblyFromDirectory(outdir, services.ioHelper, readLock, props.loadAssemblyOptions);
          });
        },
      },
      contextAssemblyProps,
    );
  }
}

