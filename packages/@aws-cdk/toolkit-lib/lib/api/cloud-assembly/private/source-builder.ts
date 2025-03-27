import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import type { AssemblyDirectoryProps, AssemblySourceProps, ICloudAssemblySource } from '../';
import type { ContextAwareCloudAssemblyProps } from './context-aware-source';
import { ContextAwareCloudAssembly } from './context-aware-source';
import { execInChildProcess } from './exec';
import { ExecutionEnviornment, assemblyFromDirectory } from './prepare-source';
import type { ToolkitServices } from '../../../toolkit/private';
import type { ILock } from '../../aws-cdk';
import { Context, RWLock, Settings } from '../../aws-cdk';
import { IO } from '../../io/private';
import { ToolkitError, AssemblyError } from '../../shared-public';
import type { AssemblyBuilder } from '../source-builder';

export abstract class CloudAssemblySourceBuilder {
  /**
   * Helper to provide the CloudAssemblySourceBuilder with required toolkit services
   * @deprecated this should move to the toolkit really.
   */
  protected abstract sourceBuilderServices(): Promise<ToolkitServices>;

  /**
   * Create a Cloud Assembly from a Cloud Assembly builder function.
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

    return new ContextAwareCloudAssembly(
      {
        produce: async () => {
          const x = new ExecutionEnviornment(services, { outdir: props.outdir });
          const env = await x.defaultEnvVars();
          const assembly = await x.changeDir(async () =>
            x.withContext(context.all, env, props.synthOptions ?? {}, async (envWithContext, ctx) =>
              x.withEnv(envWithContext, () => {
                try {
                  return builder({
                    outdir: x.outdir,
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

          if (cxapi.CloudAssembly.isCloudAssembly(assembly)) {
            return assembly;
          }

          return assemblyFromDirectory(assembly.directory, services.ioHelper, props.loadAssemblyOptions);
        },
      },
      contextAssemblyProps,
    );
  }

  /**
   * Creates a Cloud Assembly from an existing assembly directory.
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

    return new ContextAwareCloudAssembly(
      {
        produce: async () => {
          // @todo build
          await services.ioHelper.notify(IO.CDK_ASSEMBLY_I0150.msg('--app points to a cloud assembly, so we bypass synth'));
          return assemblyFromDirectory(directory, services.ioHelper, props.loadAssemblyOptions);
        },
      },
      contextAssemblyProps,
    );
  }
  /**
   * Use a directory containing an AWS CDK app as source.
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

    return new ContextAwareCloudAssembly(
      {
        produce: async () => {
          let lock: ILock | undefined = undefined;
          try {
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

            lock = await new RWLock(outdir).acquireWrite();

            const x = new ExecutionEnviornment(services, { outdir });
            const commandLine = await x.guessExecutable(app);
            const env = await x.defaultEnvVars();
            return await x.withContext(context.all, env, props.synthOptions, async (envWithContext, _ctx) => {
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
              return assemblyFromDirectory(outdir, services.ioHelper, props.loadAssemblyOptions);
            });
          } finally {
            await lock?.release();
          }
        },
      },
      contextAssemblyProps,
    );
  }
}

