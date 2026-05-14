import * as fs from 'fs';
import * as path from 'path';
import { yarn } from 'cdklabs-projen-project-types';
import type { TypeScriptWorkspaceOptions } from 'cdklabs-projen-project-types/lib/yarn';

const TOOLS_PACKAGE_NAME = '@aws-cdk/tools';
const TOOLS_KEY = Symbol.for('aws-cdk-cli.tools-workspace');

export interface ToolsWorkspaceOptions extends Omit<TypeScriptWorkspaceOptions, 'name' | 'description' | 'srcdir'> {
  /**
   * Runtime dependencies that `esbuild` will bundle into the tool outputs.
   */
  readonly deps?: string[];
  /**
   * Dev dependencies (must at minimum include `esbuild`).
   */
  readonly devDeps?: string[];
}

/**
 * Private monorepo package that hosts small, self-contained utilities.
 *
 * Each subdirectory of `lib/` is a "tool": it has its own `index.ts` source
 * and is bundled by `esbuild` into a single `lib/<tool>/index.js` (with a
 * matching `.d.ts`). Tools are auto-discovered from the filesystem.
 *
 * Consumers take a `devDependency` on this package and use `useTools` on
 * `CdkTypeScriptWorkspace` to cherry-pick bundled tools into their source
 * tree at pre-compile time.
 */
export class ToolsWorkspace extends yarn.TypeScriptWorkspace {
  /**
   * Tool names discovered under `lib/`.
   */
  public readonly toolNames: readonly string[];

  constructor(options: ToolsWorkspaceOptions) {
    super({
      ...options,
      name: TOOLS_PACKAGE_NAME,
      description: 'Bundled utility tools that other packages cherry-pick from',
      srcdir: 'lib',
      private: true,
      devDeps: ['esbuild', ...(options.devDeps ?? [])],
    });

    // Register this workspace on the parent monorepo so that consumer
    // workspaces can locate it via `options.parent`.
    (options.parent as any)[TOOLS_KEY] = this;

    this.toolNames = discoverTools(path.join(options.parent?.outdir ?? '.', 'packages/@aws-cdk/tools/lib'));

    // Per-tool esbuild bundle step after tsc compile. The `.d.ts` output
    // from tsc is left untouched for consumers to consume.
    for (const tool of this.toolNames) {
      this.postCompileTask.exec(
        [
          'esbuild',
          '--bundle',
          `lib/${tool}/index.ts`,
          '--platform=node',
          '--target=node18',
          `--outfile=lib/${tool}/index.js`,
          '--allow-overwrite',
        ].join(' '),
      );
    }
    this.gitignore.addPatterns('*.js', '*.d.ts');
  }
}

/**
 * Locate the `ToolsWorkspace` attached to a monorepo (if any).
 */
function findTools(parent: unknown): ToolsWorkspace | undefined {
  return parent ? (parent as any)[TOOLS_KEY] : undefined;
}

/**
 * List the immediate subdirectories of `dir` that contain an `index.ts`.
 * Returns an empty array if `dir` does not exist yet (first projen run).
 */
function discoverTools(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'index.ts')))
    .map((e) => e.name)
    .sort();
}

export interface CdkTypeScriptWorkspaceOptions extends TypeScriptWorkspaceOptions {
  /**
   * Names of tools from `@aws-cdk/tools` to cherry-pick into this package.
   *
   * For each name, the bundled `lib/<tool>/index.{js,d.ts}` from
   * `@aws-cdk/tools` is copied into this package's `lib/private/<tool>/`
   * at pre-compile time, so the consumer can import from
   * `./private/<tool>` and ship the bundled file on publish.
   *
   * @default - no tools
   */
  readonly useTools?: string[];
}

/**
 * A `yarn.TypeScriptWorkspace` that can optionally cherry-pick bundled tools
 * from the monorepo's `@aws-cdk/tools` workspace via `useTools`.
 */
export class CdkTypeScriptWorkspace extends yarn.TypeScriptWorkspace {
  constructor(options: CdkTypeScriptWorkspaceOptions) {
    const { useTools = [], ...rest } = options;
    const toolsWorkspace = findTools(options.parent);
    super({
      ...rest,
      devDeps: [
        ...(useTools.length > 0 && toolsWorkspace ? [toolsWorkspace as any] : []),
        ...(rest.devDeps ?? []),
      ],
    });

    if (useTools.length === 0) {
      return;
    }
    if (!toolsWorkspace) {
      throw new Error(`useTools was specified but no ToolsWorkspace is registered on the monorepo (package ${options.name})`);
    }

    for (const tool of useTools) {
      if (!toolsWorkspace.toolNames.includes(tool)) {
        throw new Error(`Unknown tool '${tool}' requested by ${options.name}; known tools: ${toolsWorkspace.toolNames.join(', ')}`);
      }
      this.wireTool(tool);
    }
  }

  private wireTool(tool: string) {
    const dest = `lib/private/tools/${tool}`;
    const script = [
      `const p=require.resolve('${TOOLS_PACKAGE_NAME}/lib/${tool}/index.js');`,
      "const d=require('path').dirname(p);",
      "const fs=require('fs');",
      `fs.mkdirSync('${dest}',{recursive:true});`,
      `fs.copyFileSync(p,'${dest}/index.js');`,
      `fs.copyFileSync(require('path').join(d,'index.d.ts'),'${dest}/index.d.ts');`,
    ].join('');
    this.preCompileTask.exec(`node -e "${script}"`);

    // Exclude the copied (generated) bundle from test coverage.
    const jest = this.tryFindObjectFile('jest.config.json');
    jest?.addOverride(
      'coveragePathIgnorePatterns',
      [...((jest as any).obj?.coveragePathIgnorePatterns ?? []), `${dest}/index\\.js$`],
    );
  }
}
