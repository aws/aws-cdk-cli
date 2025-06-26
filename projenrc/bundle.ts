import * as pj from 'projen';

/**
 * Bundling properties.
 */
export interface BundleProps {
  /**
   * List of entry-points to bundle.
   *
   * @default - the 'main' file as specified in package.json.
   */
  readonly entryPoints?: string[];

  /**
   * Path to attributions file that will be created / validated.
   * This path is relative to the package directory.
   *
   * @default 'THIRD_PARTY_LICENSES'
   */
  readonly attributionsFile?: string;

  /**
   * External packages that cannot be bundled.
   *
   * @default - no external references.
   */
  readonly externals?: Externals;

  /**
   * External resources that need to be embedded in the bundle.
   *
   * These will be copied over to the appropriate paths before packaging.
   */
  readonly resources?: { [src: string]: string };

  /**
   * A list of licenses that are allowed for bundling.
   * If any dependency contains a license not in this list, bundling will fail.
   *
   * @default - Default list
   */
  readonly allowedLicenses?: string[];

  /**
   * Packages matching this regular expression will be excluded from attribution.
   */
  readonly dontAttribute?: string;

  /**
   * Basic sanity check to run against the created bundle.
   *
   * @default - no check.
   */
  readonly test?: string;

  /**
   * Include a sourcemap in the bundle.
   *
   * @default "inline"
   */
  readonly sourcemap?: 'linked' | 'inline' | 'external' | 'both';

  /**
   * Minifies the bundled code.
   *
   * @default false
   */
  readonly minify?: boolean;

  /**
   * Removes whitespace from the code.
   * This is enabled by default when `minify` is used.
   *
   * @default false
   */
  readonly minifyWhitespace?: boolean;

  /**
   * Renames local variables to be shorter.
   * This is enabled by default when `minify` is used.
   *
   * @default false
   */
  readonly minifyIdentifiers?: boolean;

  /**
   * Rewrites syntax to a more compact format.
   * This is enabled by default when `minify` is used.
   *
   * @default false
   */
  readonly minifySyntax?: boolean;

  /**
   * Write a meatafile to the dist directory.
   *
   * @default false
   */
  readonly metafile?: boolean;
}

/**
 * External packages that cannot be bundled.
 */
export interface Externals {

  /**
   * External packages that should be listed in the `dependencies` section
   * of the manifest.
   */
  readonly dependencies?: readonly string[];

  /**
   * External packages that should be listed in the `optionalDependencies` section
   * of the manifest.
   */
  readonly optionalDependencies?: readonly string[];

}

export class BundleCli extends pj.Component {
  constructor(project: pj.Project, options: BundleProps) {
    super(project);

    const args = [
      ...(options.externals?.dependencies ?? []).map(d => `--external ${d}:runtime`),
      ...(options.externals?.optionalDependencies ?? []).map(d => `--external ${d}:optional`),
      ...(options.allowedLicenses ?? []).map(l => `--allowed-license "${l}"`),
      ...options.dontAttribute ? [`--dont-attribute ${quoteShellArg(options.dontAttribute)}`] : [],
      ...options.test ? [`--test ${quoteShellArg(options.test)}`] : [],
      ...(options.entryPoints ?? []).map(e => `--entrypoint ${quoteShellArg(e)}`),

      // All of these options are not available via the CLI api
      /*
      ...options.sourcemap ? [`--sourcemap ${JSON.stringify(options.sourcemap)}`] : [],
      ...options.minify ? ['--minify'] : [],
      ...options.minifyWhitespace ? ['--minify-whitespace'] : [],
      ...options.minifyIdentifiers ? ['--minify-identifiers'] : [],
      ...options.minifySyntax ? ['--minify-syntax'] : [],
      ...Object.entries(options.resources ?? {}).map(([src, dst]) => `--resource ${JSON.stringify(src)}:${JSON.stringify(dst)}`),
      */
    ];

    project.deps.addDependency('node-backpack', pj.DependencyType.BUILD);

    // Generate the license file
    project.postCompileTask.exec(['node-backpack', 'validate', '--fix', ...args].join(' '));

    // `node-bundle` replaces `npm pack`
    const packArgs = [
      ...args,
      ...(options.metafile ?? true) ? ['--metafile dist/metafile.json'] : [],
    ];
    project.packageTask.reset();
    project.packageTask.exec('mkdir -p dist/js');
    project.packageTask.exec(['node-backpack', 'pack', '--destination', 'dist/js', ...packArgs].join(' '));
  }
}

/**
 * Quote a shell argument (for POSIX shells)
 *
 * Uses single quotes (no character means anything special other than
 * single quotes themselvs), and escape single quotes by exiting the string,
 * adding in a literal single quote, and re-entering the string.
 *
 *     as'df
 *
 * Gets rendered as
 *
 *     'as'\''df'
 */
function quoteShellArg(x: string) {
  return `'${x.replace(/'/g, "'\\''")}'`;
}
