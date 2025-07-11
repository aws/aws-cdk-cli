import * as path from 'path';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import { shell } from './os';
import type { IoHelper } from '../../api-private';
import { formatErrorMessage } from '../../util';

export type SubstitutePlaceholders = (...fileNames: string[]) => Promise<void>;

/**
 * Helpers passed to hook functions
 */
export interface HookContext {
  /**
   * Callback function to replace placeholders on arbitrary files
   *
   * This makes token substitution available to non-`.template` files.
   */
  readonly substitutePlaceholdersIn: SubstitutePlaceholders;

  /**
   * Return a single placeholder
   */
  placeholder(name: string): string;
}

export type InvokeHook = (targetDirectory: string, context: HookContext) => Promise<void>;

export interface HookTarget {
  readonly targetDirectory: string;
  readonly templateName: string;
  readonly language: string;
}

/**
 * Invoke hooks for the given init template
 *
 * Sometimes templates need more complex logic than just replacing tokens. A 'hook' can be
 * used to do additional processing other than copying files.
 *
 * Hooks used to be defined externally to the CLI, by running arbitrarily
 * substituted shell scripts in the target directory.
 *
 * In practice, they're all TypeScript files and all the same, and the dynamism
 * that the original solution allowed wasn't used at all. Worse, since the CLI
 * is now bundled the hooks can't even reuse code from the CLI libraries at all
 * anymore, so all shared code would have to be copy/pasted.
 *
 * Bundle hooks as built-ins into the CLI, so they get bundled and can take advantage
 * of all shared code.
 */
export async function invokeBuiltinHooks(ioHelper: IoHelper, target: HookTarget, context: HookContext) {
  switch (target.language) {
    case 'csharp':
      if (['app', 'sample-app'].includes(target.templateName)) {
        return dotnetAddProject(ioHelper, target.targetDirectory, context);
      }
      break;

    case 'fsharp':
      if (['app', 'sample-app'].includes(target.templateName)) {
        return dotnetAddProject(ioHelper, target.targetDirectory, context, 'fsproj');
      }
      break;

    case 'python':
      // We can't call this file 'requirements.template.txt' because Dependabot needs to be able to find it.
      // Therefore, keep the in-repo name but still substitute placeholders.
      await context.substitutePlaceholdersIn('requirements.txt');
      break;

    case 'java':
      // We can't call this file 'pom.template.xml'... for the same reason as Python above.
      await context.substitutePlaceholdersIn('pom.xml');
      break;

    case 'javascript':
    case 'typescript':
      // See above, but for 'package.json'.
      await context.substitutePlaceholdersIn('package.json');
  }
}

async function dotnetAddProject(ioHelper: IoHelper, targetDirectory: string, context: HookContext, ext = 'csproj') {
  const pname = context.placeholder('name.PascalCased');
  const slnPath = path.join(targetDirectory, 'src', `${pname}.sln`);
  const csprojPath = path.join(targetDirectory, 'src', pname, `${pname}.${ext}`);

  // We retry this command a couple of times. It usually never fails, except on CI where
  // we sometimes see:
  //
  //   System.IO.IOException: The system cannot open the device or file specified. : 'NuGet-Migrations'
  //
  // This error can be caused by lack of permissions on a temporary directory,
  // but in our case it's intermittent so my guess is it is caused by multiple
  // invocations of the .NET CLI running in parallel, and trampling on each
  // other creating a Mutex. There is no fix, and it is annoyingly breaking our
  // CI regularly. Retry a couple of times to increase reliability.
  //
  // - https://github.com/dotnet/sdk/issues/43750
  // - https://github.com/dotnet/runtime/issues/80619
  // - https://github.com/dotnet/runtime/issues/91987
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      await shell(ioHelper, ['dotnet', 'sln', slnPath, 'add', csprojPath]);
      return;
    } catch (e: any) {
      if (attempt === MAX_ATTEMPTS) {
        throw new ToolkitError(`Could not add project ${pname}.${ext} to solution ${pname}.sln. ${formatErrorMessage(e)}`);
      }

      // Sleep for a bit then try again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
