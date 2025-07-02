import * as childProcess from 'child_process';
import { format } from 'util';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import * as cxapi from '@aws-cdk/cx-api';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import * as fs from 'fs-extra';
import type { IoHelper } from '../../lib/api-private';
import type { SdkProvider, IReadLock } from '../api';
import { RWLock, guessExecutable, prepareDefaultEnvironment, writeContextToEnv, synthParametersFromSettings } from '../api';
import type { Configuration } from '../cli/user-configuration';
import { PROJECT_CONFIG, USER_DEFAULTS } from '../cli/user-configuration';
import { versionNumber } from '../cli/version-util';

export interface ExecProgramResult {
  readonly assembly: cxapi.CloudAssembly;
  readonly lock: IReadLock;
}

/** Invokes the cloud executable and returns JSON output */
export async function execProgram(aws: SdkProvider, ioHelper: IoHelper, config: Configuration): Promise<ExecProgramResult> {
  const debugFn = (msg: string) => ioHelper.defaults.debug(msg);

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

  const app = config.settings.get(['app']);
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

  // Acquire a lock on the output directory
  const writerLock = await new RWLock(outdir).acquireWrite();

  // Send version information
  env[cxapi.CLI_ASM_VERSION_ENV] = cxschema.Manifest.version();
  env[cxapi.CLI_VERSION_ENV] = versionNumber();

  await debugFn(format('env:', env));

  const cleanupTemp = writeContextToEnv(env, context, 'add-process-env-later');
  try {
    await exec(commandLine.join(' '));

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
      await new Promise<void>((ok, fail) => {
        // We use a slightly lower-level interface to:
        //
        // - Pass arguments in an array instead of a string, to get around a
        //   number of quoting issues introduced by the intermediate shell layer
        //   (which would be different between Linux and Windows).
        //
        // - Inherit stderr from controlling terminal. We don't use the captured value
        //   anyway, and if the subprocess is printing to it for debugging purposes the
        //   user gets to see it sooner. Plus, capturing doesn't interact nicely with some
        //   processes like Maven.
        const proc = childProcess.spawn(commandAndArgs, {
          stdio: ['ignore', 'inherit', 'inherit'],
          detached: false,
          shell: true,
          env: {
            ...process.env,
            ...env,
          },
        });

        proc.on('error', fail);

        proc.on('exit', code => {
          if (code === 0) {
            return ok();
          } else {
            return fail(new ToolkitError(`${commandAndArgs}: Subprocess exited with error ${code}`));
          }
        });
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
    return new cxapi.CloudAssembly(appDir, {
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
