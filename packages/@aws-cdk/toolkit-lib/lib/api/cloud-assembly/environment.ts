import * as path from 'path';
import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import type { SdkProvider } from '../aws-auth/private';
import type { Settings } from '../settings';
import { Command } from './private/exec';

export type Env = { [key: string]: string | undefined };
export type Context = { [key: string]: unknown };

/**
 * If we don't have region/account defined in context, we fall back to the default SDK behavior
 * where region is retrieved from ~/.aws/config and account is based on default credentials provider
 * chain and then STS is queried.
 *
 * This is done opportunistically: for example, if we can't access STS for some reason or the region
 * is not configured, the context value will be 'null' and there could failures down the line. In
 * some cases, synthesis does not require region/account information at all, so that might be perfectly
 * fine in certain scenarios.
 *
 * @param context - The context key/value bash.
 */
export async function prepareDefaultEnvironment(
  aws: SdkProvider,
  debugFn: (msg: string) => Promise<void>,
): Promise<Env> {
  const env: Env = {};

  env[cxapi.DEFAULT_REGION_ENV] = aws.defaultRegion;
  await debugFn(`Setting "${cxapi.DEFAULT_REGION_ENV}" environment variable to ${env[cxapi.DEFAULT_REGION_ENV]}`);

  const accountId = (await aws.defaultAccount())?.accountId;
  if (accountId) {
    env[cxapi.DEFAULT_ACCOUNT_ENV] = accountId;
    await debugFn(`Setting "${cxapi.DEFAULT_ACCOUNT_ENV}" environment variable to ${env[cxapi.DEFAULT_ACCOUNT_ENV]}`);
  }

  return env;
}

/**
 * Create context from settings.
 *
 * Mutates the `context` object and returns it.
 */
export function contextFromSettings(
  settings: Settings,
) {
  const context: Record<string, unknown> = {};

  const pathMetadata: boolean = settings.get(['pathMetadata']) ?? true;
  if (pathMetadata) {
    context[cxapi.PATH_METADATA_ENABLE_CONTEXT] = true;
  }

  const assetMetadata: boolean = settings.get(['assetMetadata']) ?? true;
  if (assetMetadata) {
    context[cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT] = true;
  }

  const versionReporting: boolean = settings.get(['versionReporting']) ?? true;
  if (versionReporting) {
    context[cxapi.ANALYTICS_REPORTING_ENABLED_CONTEXT] = true;
  }
  // We need to keep on doing this for framework version from before this flag was deprecated.
  if (!versionReporting) {
    context['aws:cdk:disable-version-reporting'] = true;
  }

  const stagingEnabled = settings.get(['staging']) ?? true;
  if (!stagingEnabled) {
    context[cxapi.DISABLE_ASSET_STAGING_CONTEXT] = true;
  }

  const bundlingStacks = settings.get(['bundlingStacks']) ?? ['**'];
  context[cxapi.BUNDLING_STACKS] = bundlingStacks;

  return context;
}

/**
 * Convert settings to context/environment variables
 */
export function synthParametersFromSettings(settings: Settings): {
  context: Context;
  env: Env;
} {
  return {
    context: contextFromSettings(settings),
    env: {
      // An environment variable instead of a context variable, so it can also
      // be accessed in framework code where we don't have access to a construct tree.
      ...settings.get(['debug']) ? { CDK_DEBUG: 'true' } : {},
    },
  };
}

export function spaceAvailableForContext(env: Env, limit: number) {
  const size = (value?: string) => value != null ? Buffer.byteLength(value) : 0;

  const usedSpace = Object.entries(env)
    .map(([k, v]) => k === cxapi.CONTEXT_ENV ? size(k) : size(k) + size(v))
    .reduce((a, b) => a + b, 0);

  return Math.max(0, limit - usedSpace);
}

/**
 * Guess the executable from the string command
 *
 * Input is the "app" string the user gave us. Output is the command line we are going to execute.
 *
 * - On Windows: it's hard to verify if registry associations have or have not
 *   been set up for this file type (i.e., ShellExec'ing the file will work or not),
 *   so we'll assume the worst and take control ourselves.
 *
 * - On POSIX: if the file is NOT marked as executable, guess the interpreter. If it is executable,
 *   the correct interpreter should be in the file's shebang and we just execute it directly.
 *
 * The behavior of only guessing the interpreter if the command line is a single file name
 * is a bit limited: we can't put a `.js` file with arguments in the command line and have
 * it work properly. Nevertheless, this is the behavior we have had for a long time and nobody
 * has really complained about it, so we'll keep it for now.
 */
export function guessExecutable(command: Command, debugFn: (msg: string) => Promise<void>): Promise<Command> {
  switch (command.type) {
    case 'argv':
      return guessArgvExecutable(command, debugFn);
    case 'shell':
      return guessShellExecutable(command, debugFn);
  }
}

export async function guessArgvExecutable(command: Extract<Command, { type: 'argv' }>, debugFn: (msg: string) => Promise<void>): Promise<Command> {
  // We perform "guessInterpreter" on the first value in the array to execute successfully on Windows and on POSIX without the executable
  // bit, and nothing else.
  const [first, ...rest] = command.argv;
  const firstFile = await checkFile(first);
  if (firstFile) {
    return {
      type: 'argv',
      argv: [...guessInterpreter(firstFile), ...rest],
    };
  }

  // Not a file, so just use the given command line
  await debugFn(`Not a file: '${first}'. Using ${JSON.stringify(command.argv)} as command`);
  return command;
}

export async function guessShellExecutable(command: Extract<Command, { type: 'shell' }>, debugFn: (msg: string) => Promise<void>): Promise<Command> {
  // The command line with spaces in it could reference a file on disk. If true,
  // we quote it and return that, optionally by prefixing an interpreter.
  const fullFile = await checkFile(command.command);
  if (fullFile) {
    return {
      type: 'shell',
      command: guessInterpreter(fullFile).map(quoteSpaces).join(' '),
    };
  }

  // Otherwise, the first word on the command line could reference a file on
  // disk (quoted or non-quoted). If true, we optionally prefix an interpreter.
  const [first, rest] = splitFirstShellWord(command.command);
  const firstFile = await checkFile(first);
  if (firstFile) {
    return {
      type: 'shell',
      command: [...guessInterpreter(firstFile).map(quoteSpaces), rest].join(' ').trim(),
    };
  }

  // We couldn't parse it, so just use the given command line.
  await debugFn(`Not a file: '${command.command}'. Using '${command.command} as command-line`);
  return command;
}

/**
 * Guess the right interpreter to use to execute the given file and return a (partial) command line to execute it.
 *
 * This may entail:
 *
 * - Prefixing an interpreter if necessary
 * - Quoting the file name if necessary
 */
function guessInterpreter(file: FileInfo): string[] {
  const isWindows = process.platform === 'win32';

  const handler = EXTENSION_MAP[path.extname(file.fileName)];
  if (handler && (!file.isExecutable || isWindows)) {
    return handler(file.fileName);
  }

  return [file.fileName];
}

/**
 * Mapping of extensions to command-line generators
 */
const EXTENSION_MAP: Record<string, CommandGenerator> = {
  '.js': executeNode,
};

type CommandGenerator = (file: string) => string[];

/**
 * Execute the given file with the same 'node' process as is running the current process
 */
function executeNode(scriptFile: string): string[] {
  return [process.execPath, scriptFile];
}

/**
 * Parse off the first quoted or unquoted shell word.
 */
function splitFirstShellWord(commandLine: string): [string, string] {
  commandLine = commandLine.trim();
  if (commandLine[0] === '"') {
    // Split on the next quote, ignore any escaping
    const endQuote = commandLine.indexOf('"', 1);
    return endQuote > -1 ? [commandLine.slice(1, endQuote), commandLine.slice(endQuote + 1).trim()] : [commandLine, ''];
  } else {
    // Split on the first space
    const space = commandLine.indexOf(' ');
    return space > -1 ? [commandLine.slice(0, space), commandLine.slice(space + 1)] : [commandLine, ''];
  }
}

/**
 * Look up a file and see if it exists and is executable
 */
async function checkFile(fileName: string): Promise<FileInfo | undefined> {
  try {
    const fstat = await fs.stat(fileName);
    return  {
      fileName,
      // eslint-disable-next-line no-bitwise
      isExecutable: (fstat.mode & fs.constants.X_OK) !== 0,
    };
  } catch {
    return undefined;
  }
}

interface FileInfo {
  readonly fileName: string;
  readonly isExecutable: boolean;
}

/**
 * Quote a shell part if it contains spaces
 *
 * We're only interested in spaces, nothing else.
 */
function quoteSpaces(part: string) {
  if (part.includes(' ')) {
    return `"${part}"`;
  }
  return part;
}
