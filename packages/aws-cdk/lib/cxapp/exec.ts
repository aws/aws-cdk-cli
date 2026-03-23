import { format } from 'util';
import { CloudAssembly } from '@aws-cdk/cloud-assembly-api';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import * as cxapi from '@aws-cdk/cx-api';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import * as fs from 'fs-extra';
import * as path from 'path';
import type { IoHelper } from '../../lib/api-private';
import type { SdkProvider, IReadLock } from '../api';
import { RWLock, guessExecutable, prepareDefaultEnvironment, writeContextToEnv, synthParametersFromSettings, execInChildProcess } from '../api';
import type { Configuration } from '../cli/user-configuration';
import { PROJECT_CONFIG, USER_DEFAULTS } from '../cli/user-configuration';
import { versionNumber } from '../cli/version';

export interface ExecProgramResult {
  readonly assembly: CloudAssembly;
  readonly lock: IReadLock;
}

/** Invokes the cloud executable and returns JSON output */
export async function execProgram(aws: SdkProvider, ioHelper: IoHelper, config: Configuration): Promise<ExecProgramResult> {
  const debugFn = (msg: string) => ioHelper.defaults.debug(msg);
  let errorFile: string | undefined;

  const params = synthParametersFromSettings(config.settings);

  const context = {
    ...config.context.all,
    ...params.context,
  };
  await debugFn(format('context:', context));

  const env: Record<string, string> = noUndefined({
    // Versioning, outdir, default account and region
    ...await prepareDefaultEnvironment(aws, debugFn),
    // Environment variables derived from settings
    ...params.env,
  });

  const build = config.settings.get(['build']);
  if (build) {
    await exec(build);
  }

  let app = config.settings.get(['app']);
  if (!app) {
    throw new ToolkitError(`--app is required either in command-line, in ${PROJECT_CONFIG} or in ${USER_DEFAULTS}`);
  }

  // bypass "synth" if app points to a cloud assembly
  if (await fs.pathExists(app) && (await fs.stat(app)).isDirectory()) {
    await debugFn('--app points to a cloud assembly, so we bypass synth');

    // Acquire a read lock on this directory
    const lock = await new RWLock(app).acquireRead();

    return { assembly: createAssembly(app), lock };
  }

  // Traditionally it has been possible, though not widely advertised, to put a string[] into `cdk.json`.
  // However, we would just quickly join this array back up to string with spaces (unquoted even!) and proceed as usual,
  // thereby losing all the benefits of a pre-segmented command line. This coercion is just here for backwards
  // compatibility with existing configurations. An upcoming PR might retain the benefit of the string[].
  if (Array.isArray(app)) {
    app = app.join(' ');
  }
  const commandLine = await guessExecutable(app, debugFn);

  const outdir = config.settings.get(['output']);
  if (!outdir) {
    throw new ToolkitError('unexpected: --output is required');
  }
  if (typeof outdir !== 'string') {
    throw new ToolkitError(`--output takes a string, got ${JSON.stringify(outdir)}`);
  }
  try {
    await fs.mkdirp(outdir);
  } catch (error: any) {
    throw new ToolkitError(`Could not create output directory ${outdir} (${error.message})`);
  }

  await debugFn(`outdir: ${outdir}`);

  env[cxapi.OUTDIR_ENV] = outdir;

  // Send version information
  env[cxapi.CLI_ASM_VERSION_ENV] = cxschema.Manifest.version();
  env[cxapi.CLI_VERSION_ENV] = versionNumber();

  // Acquire a lock on the output directory
  const writerLock = await new RWLock(outdir).acquireWrite();

  // Prepare an errorFile location
  errorFile = path.join(outdir, 'error.txt');
  await fs.promises.rm(errorFile, { force: true });
  env.CDK_ERROR_FILE = errorFile;

  await debugFn(format('env:', env));

  const cleanupTemp = writeContextToEnv(env, context, 'add-process-env-later');
  try {
    await exec(commandLine);

    const assembly = createAssembly(outdir);

    return { assembly, lock: await writerLock.convertToReaderLock() };
  } catch (e) {
    await writerLock.release();
    throw e;
  } finally {
    await cleanupTemp();
  }

  async function exec(commandAndArgs: string) {
    try {
      return await execInChildProcess(commandAndArgs, {
        env: {
          ...process.env,
          ...env,
        },
        errorCodeFile: errorFile,
      });
    } catch (e: any) {
      await debugFn(`failed command: ${commandAndArgs}`);
      throw e;
    }
  }
}

/**
 * Creates an assembly with error handling
 */
export function createAssembly(appDir: string) {
  try {
    return new CloudAssembly(appDir, {
      // We sort as we deploy
      topoSort: false,
    });
  } catch (error: any) {
    if (error.message.includes(cxschema.VERSION_MISMATCH)) {
      // this means the CLI version is too old.
      // we instruct the user to upgrade.
      throw new ToolkitError(`This CDK CLI is not compatible with the CDK library used by your application. Please upgrade the CLI to the latest version.\n(${error.message})`);
    }
    throw error;
  }
}

function noUndefined<A>(xs: Record<string, A>): Record<string, NonNullable<A>> {
  return Object.fromEntries(Object.entries(xs).filter(([_, v]) => v !== undefined)) as any;
}
