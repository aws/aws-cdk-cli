import * as os from 'node:os';
import * as path from 'node:path';
import { format } from 'node:util';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import { lte } from 'semver';
import type { SdkProvider } from '../../../api/aws-cdk';
import { loadTree, some } from '../../../api/aws-cdk';
import { prepareDefaultEnvironment as oldPrepare, prepareContext, spaceAvailableForContext, Settings, guessExecutable } from '../../../api/shared-private';
import { splitBySize, versionNumber } from '../../../private/util';
import type { ToolkitServices } from '../../../toolkit/private';
import { IO } from '../../io/private';
import type { IoHelper } from '../../shared-private';
import { ToolkitError } from '../../shared-public';
import type { AppSynthOptions, LoadAssemblyOptions } from '../source-builder';

type Env = { [key: string]: string };
type Context = { [key: string]: any };

export class ExecutionEnvironment {
  private readonly ioHelper: IoHelper;
  private readonly sdkProvider: SdkProvider;
  private readonly debugFn: (msg: string) => Promise<void>;
  private _outdir: string | undefined;

  public constructor(services: ToolkitServices, props: { outdir?: string } = {}) {
    this.ioHelper = services.ioHelper;
    this.sdkProvider = services.sdkProvider;
    this.debugFn = (msg: string) => this.ioHelper.notify(IO.DEFAULT_ASSEMBLY_DEBUG.msg(msg));
    this._outdir = props.outdir;
  }

  /**
   * Turn the given optional output directory into a fixed output directory
   */
  public get outdir(): string {
    if (!this._outdir) {
      const outdir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cdk.out'));
      this._outdir = outdir;
    }
    return this._outdir;
  }

  /**
   * Guess the executable from the command-line argument
   *
   * Only do this if the file is NOT marked as executable. If it is,
   * we'll defer to the shebang inside the file itself.
   *
   * If we're on Windows, we ALWAYS take the handler, since it's hard to
   * verify if registry associations have or have not been set up for this
   * file type, so we'll assume the worst and take control.
   */
  public guessExecutable(app: string) {
    return guessExecutable(app, this.debugFn);
  }

  /**
   * If we don't have region/account defined in context, we fall back to the default SDK behavior
   * where region is retrieved from ~/.aws/config and account is based on default credentials provider
   * chain and then STS is queried.
   *
   * This is done opportunistically: for example, if we can't access STS for some reason or the region
   * is not configured, the context value will be 'null' and there could failures down the line. In
   * some cases, synthesis does not require region/account information at all, so that might be perfectly
   * fine in certain scenarios.
   */
  public async defaultEnvVars(): Promise<Env> {
    const debugFn = (msg: string) => this.ioHelper.notify(IO.CDK_ASSEMBLY_I0010.msg(msg));
    const env = await oldPrepare(this.sdkProvider, debugFn);

    env[cxapi.OUTDIR_ENV] = this.outdir;
    await debugFn(format('outdir:', this.outdir));

    // CLI version information
    env[cxapi.CLI_ASM_VERSION_ENV] = cxschema.Manifest.version();
    env[cxapi.CLI_VERSION_ENV] = versionNumber();

    await debugFn(format('env:', env));
    return env;
  }

  /**
   * Run code from a different working directory
   */
  public async changeDir<T>(block: () => Promise<T>, workingDir?: string) {
    const originalWorkingDir = process.cwd();
    try {
      if (workingDir) {
        process.chdir(workingDir);
      }

      return await block();
    } finally {
      if (workingDir) {
        process.chdir(originalWorkingDir);
      }
    }
  }

  /**
   * Run code with additional environment variables
   */
  public async withEnv<T>(env: Env = {}, block: () => Promise<T>) {
    const originalEnv = process.env;
    try {
      process.env = {
        ...originalEnv,
        ...env,
      };

      return await block();
    } finally {
      process.env = originalEnv;
    }
  }

  /**
   * Run code with context setup inside the environment
   */
  public async withContext<T>(
    inputContext: Context,
    env: Env,
    synthOpts: AppSynthOptions = {},
    block: (env: Env, context: Context) => Promise<T>,
  ) {
    const context = await prepareContext(synthOptsDefaults(synthOpts), inputContext, env, this.debugFn);
    let contextOverflowLocation = null;

    try {
      const envVariableSizeLimit = os.platform() === 'win32' ? 32760 : 131072;
      const [smallContext, overflow] = splitBySize(context, spaceAvailableForContext(env, envVariableSizeLimit));

      // Store the safe part in the environment variable
      env[cxapi.CONTEXT_ENV] = JSON.stringify(smallContext);

      // If there was any overflow, write it to a temporary file
      if (Object.keys(overflow ?? {}).length > 0) {
        const contextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-context'));
        contextOverflowLocation = path.join(contextDir, 'context-overflow.json');
        fs.writeJSONSync(contextOverflowLocation, overflow);
        env[cxapi.CONTEXT_OVERFLOW_LOCATION_ENV] = contextOverflowLocation;
      }

      // call the block code with new environment
      return await block(env, context);
    } finally {
      if (contextOverflowLocation) {
        fs.removeSync(path.dirname(contextOverflowLocation));
      }
    }
  }
}

/**
 * Checks if a given assembly supports context overflow, warn otherwise.
 *
 * @param assembly the assembly to check
 */
async function checkContextOverflowSupport(assembly: cxapi.CloudAssembly, ioHelper: IoHelper): Promise<void> {
  const traceFn = (msg: string) => ioHelper.notify(IO.DEFAULT_ASSEMBLY_TRACE.msg(msg));
  const tree = await loadTree(assembly, traceFn);
  const frameworkDoesNotSupportContextOverflow = some(tree, node => {
    const fqn = node.constructInfo?.fqn;
    const version = node.constructInfo?.version;
    return (fqn === 'aws-cdk-lib.App' && version != null && lte(version, '2.38.0')) // v2
    || fqn === '@aws-cdk/core.App'; // v1
  });

  // We're dealing with an old version of the framework here. It is unaware of the temporary
  // file, which means that it will ignore the context overflow.
  if (frameworkDoesNotSupportContextOverflow) {
    await ioHelper.notify(IO.CDK_ASSEMBLY_W0010.msg('Part of the context could not be sent to the application. Please update the AWS CDK library to the latest version.'));
  }
}

/**
 * Safely create an assembly from a cloud assembly directory
 */
export async function assemblyFromDirectory(assemblyDir: string, ioHelper: IoHelper, loadOptions: LoadAssemblyOptions = {}) {
  try {
    const assembly = new cxapi.CloudAssembly(assemblyDir, {
      skipVersionCheck: !(loadOptions.checkVersion ?? true),
      skipEnumCheck: !(loadOptions.checkEnums ?? true),
      // We sort as we deploy
      topoSort: false,
    });
    await checkContextOverflowSupport(assembly, ioHelper);
    return assembly;
  } catch (err: any) {
    if (err.message.includes(cxschema.VERSION_MISMATCH)) {
      // this means the CLI version is too old.
      // we instruct the user to upgrade.
      const message = 'This AWS CDK Toolkit is not compatible with the AWS CDK library used by your application. Please upgrade to the latest version.';
      await ioHelper.notify(IO.CDK_ASSEMBLY_E1111.msg(message, { error: err }));
      throw new ToolkitError(`${message}\n(${err.message}`);
    }
    throw err;
  }
}

function synthOptsDefaults(synthOpts: AppSynthOptions = {}): Settings {
  return new Settings({
    debug: false,
    pathMetadata: true,
    versionReporting: true,
    assetMetadata: true,
    assetStaging: true,
    ...synthOpts,
  }, true);
}
