import { Component, JsonFile } from 'projen';
import type { TypescriptConfig } from 'projen/lib/javascript';
import type { TypeScriptProject } from 'projen/lib/typescript';

/**
 * Enable type checking for the test of the given project
 *
 * This creates a `tsconfig.json` in the test directory with a `noEmit: true`
 * directive that inherits from `tsconfig.dev.json`, and adds a command job to
 * the `compile` step.
 *
 * This necessary because during refactorings it's very easy for type errors
 * to creep into tests, and the reporting of these errors only happens during
 * testing running otherwise which is annoying.
 *
 * # This looks crazy
 *
 * The needs to be called `tsconfig.json` otherwise VSCode won't load it.
 *
 * That means the file must live in `test` otherwise it will conflict with other
 * `tsconfig`s that I don't want to even think about having to rename. The
 * easiest way to add a `test/tsconfig.json` without disturbing too much is to
 * extend the parent `tsconfig.dev.json`, but we have to change the rootDir
 * and also we have to copy over references because those are not inherited.
 */
export class TypecheckTests extends Component {
  constructor(repo: TypeScriptProject) {
    super(repo);

    new JsonFile(repo, 'test/tsconfig.json', {
      obj: {
        extends: '../tsconfig.dev.json',
        compilerOptions: {
          rootDir: '..',
          noEmit: true,
        },
        // Include/exclude is inherited but references are not,
        // so we have to copy those, prepending another '..'.
        references: copyTsconfigReferences(repo.tsconfigDev).map(({ path }) => ({
          path: `../${path}`,
        })),
      },
    });

    // Also type-check tests
    repo.compileTask.exec('tsc --build test');
  }
}

/**
 * The upstream cdklabs component doesn't expose
 * those references in a convenient way, but I happen to know that it
 * registers an override into the tsconfig  file, and I know how to get
 * at those by grubbing around in projen internals.
 */
function copyTsconfigReferences(config: TypescriptConfig): Array<{ path: string }> {
  return (config.file as any).rawOverrides.references ?? [];
}
