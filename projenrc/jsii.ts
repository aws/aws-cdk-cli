import { Rosetta, yarn } from 'cdklabs-projen-project-types';
import * as pj from 'projen';
import { Stability } from 'projen/lib/cdk';
import { WorkflowSteps } from 'projen/lib/github';
import type { Job, Step, Tools } from 'projen/lib/github/workflows-model';
import { JobPermission } from 'projen/lib/github/workflows-model';
import { NodePackageManager } from 'projen/lib/javascript';
import type { CommonPublishOptions, NpmPublishOptions } from 'projen/lib/release';

export interface JsiiBuildOptions {
  /**
   * Publish to maven
   * @default - no publishing
   */
  readonly publishToMaven?: pj.cdk.JsiiJavaTarget;

  /**
   * Publish to pypi
   * @default - no publishing
   */
  readonly publishToPypi?: pj.cdk.JsiiPythonTarget;

  /**
   * Publish Go bindings to a git repository.
   * @default - no publishing
   */
  readonly publishToGo?: pj.cdk.JsiiGoTarget;

  /**
   * Publish to NuGet
   * @default - no publishing
   */
  readonly publishToNuget?: pj.cdk.JsiiDotNetTarget;

  /**
   * Automatically run API compatibility test against the latest version published to npm after compilation.
   *
   * - You can manually run compatibility tests using `yarn compat` if this feature is disabled.
   * - You can ignore compatibility failures by adding lines to a ".compatignore" file.
   *
   * @default false
   */
  readonly compat?: boolean;

  /**
   * Name of the ignore file for API compatibility tests.
   *
   * @default ".compatignore"
   */
  readonly compatIgnore?: string;

  /**
   * Accepts a list of glob patterns. Files matching any of those patterns will be excluded from the TypeScript compiler input.
   *
   * By default, jsii will include all *.ts files (except .d.ts files) in the TypeScript compiler input.
   * This can be problematic for example when the package's build or test procedure generates .ts files
   * that cannot be compiled with jsii's compiler settings.
   */
  readonly excludeTypescript?: string[];

  /**
   * File path for generated docs.
   * @default "API.md"
   */
  readonly docgenFilePath?: string;

  /**
   * Emit a compressed version of the assembly
   * @default false
   */
  readonly compressAssembly?: boolean;

  /**
   * Version of the jsii compiler to use.
   *
   * Set to "*" if you want to manually manage the version of jsii in your
   * project by managing updates to `package.json` on your own.
   *
   * NOTE: The jsii compiler releases since 5.0.0 are not semantically versioned
   * and should remain on the same minor, so we recommend using a `~` dependency
   * (e.g. `~5.0.0`).
   *
   * @default "1.x"
   * @pjnew "~5.5.0"
   */
  readonly jsiiVersion?: string;

  /**
   * The default stability of the package
   *
   * @default Stable
   */
  readonly stability?: pj.cdk.Stability;

  /**
   * Generate a MarkDown file describing the jsii API
   *
   * @default true
   */
  readonly docgen?: boolean;

  /**
   * PyPI classifiers to add to `package.json`.
   *
   * @default none
   */
  readonly pypiClassifiers?: string[];

  /**
   * Whether to turn on 'strict' mode for Rosetta
   *
   * @default false
   */
  readonly rosettaStrict?: boolean;

  /**
   * Whether to turn on composite mode for the TypeScript project
   *
   * (Necessary in Monorepos)
   *
   * @default false
   */
  readonly composite?: boolean;
}

/**
 * Enable JSII building for a TypeScript project
 *
 * This class is mostly a straight-up copy/paste from
 * <https://github.com/projen/projen/blob/main/src/cdk/jsii-project.ts>.
 *
 * It has to be this way because of inheritance.
 */
export class JsiiBuild extends pj.Component {
  public readonly packageAllTask: pj.Task;
  private readonly packageJsTask: pj.Task;
  private readonly tsProject: pj.typescript.TypeScriptProject;
  private readonly monoProject: yarn.TypeScriptWorkspace;
  private readonly monorepoRelease: yarn.MonorepoRelease;

  constructor(project: yarn.TypeScriptWorkspace, options: JsiiBuildOptions) {
    super(project);

    this.monoProject = project;

    if (!(project instanceof pj.typescript.TypeScriptProject)) {
      throw new Error('JsiiBuild() must be passed a TypeScript project');
    }
    if (!project.parent || !yarn.Monorepo.isMonorepo(project.parent)) {
      throw new Error('Project root must be Monorepo component');
    }
    if (!project.parent.monorepoRelease) {
      throw new Error('Monorepo does not have a release component');
    }

    this.monorepoRelease = project.parent.monorepoRelease;

    const tsProject = project;
    this.tsProject = tsProject;

    if (tsProject.tsconfig) {
      throw new Error('The TypeScript project for JsiiBuild() must be configured with { disableTsconfig: true }');
    }
    if ((tsProject.release?.publisher as any)?.publishJobs?.npm) {
      throw new Error('The TypeScript project for JsiiBuild() must be configured without an NPM publishing job');
    }

    const srcdir = tsProject.srcdir;
    const libdir = tsProject.libdir;

    tsProject.addFields({ types: `${libdir}/index.d.ts` });

    const compressAssembly = options.compressAssembly ?? false;

    // this is an unhelpful warning
    const jsiiFlags = ['--silence-warnings=reserved-word'];
    if (compressAssembly) {
      jsiiFlags.push('--compress-assembly');
    }

    const compatIgnore = options.compatIgnore ?? '.compatignore';

    tsProject.addFields({ stability: options.stability ?? Stability.STABLE });

    if (options.stability === Stability.DEPRECATED) {
      tsProject.addFields({ deprecated: true });
    }

    const compatTask = tsProject.addTask('compat', {
      description: 'Perform API compatibility check against latest version',
      exec: `jsii-diff npm:$(node -p "require(\'./package.json\').name") -k --ignore-file ${compatIgnore} || (echo "\nUNEXPECTED BREAKING CHANGES: add keys such as \'removed:constructs.Node.of\' to ${compatIgnore} to skip.\n" && exit 1)`,
    });

    const compat = options.compat ?? false;
    if (compat) {
      tsProject.compileTask.spawn(compatTask);
    }

    tsProject.compileTask.reset(['jsii', ...jsiiFlags].join(' '));
    tsProject.watchTask.reset(['jsii', '-w', ...jsiiFlags].join(' '));

    // Create a new package:all task, it will be filled with language targets later
    this.packageAllTask = tsProject.addTask('package-all', {
      description: 'Packages artifacts for all target languages',
    });

    // in jsii we consider the entire repo (post build) as the build artifact
    // which is then used to create the language bindings in separate jobs.
    // we achieve this by doing a checkout and overwrite with the files from the js package.
    this.packageJsTask = this.addPackagingTask('js');

    // When running inside CI we initially only package js. Other targets are packaged in separate jobs.
    // Outside of CI (i.e locally) we simply package all targets.
    tsProject.packageTask.reset();
    tsProject.packageTask.spawn(this.packageJsTask, {
      // Only run in CI
      condition: 'node -e "if (!process.env.CI) process.exit(1)"',
    });

    // Do not spawn 'package-all' automatically as part of 'package', the jsii packaging will
    // be done as part of the release task.
    /*
    tsProject.packageTask.spawn(this.packageAllTask, {
      // Don't run in CI
      condition: 'node -e "if (process.env.CI) process.exit(1)"',
    });
    */

    const targets: Record<string, any> = {};

    const jsii: any = {
      outdir: tsProject.artifactsDirectory,
      targets,
      tsc: {
        outDir: libdir,
        rootDir: srcdir,
      },
    };

    if (options.excludeTypescript) {
      jsii.excludeTypescript = options.excludeTypescript;
    }

    if (options.composite) {
      jsii.projectReferences = true;
    }

    tsProject.addFields({ jsii });

    // FIXME: Not support "runsOn" and the workflow container image for now
    const extraJobOptions: Partial<Job> = {
      /*
        ...this.getJobRunsOnConfig(options),
        ...(options.workflowContainerImage
          ? { container: { image: options.workflowContainerImage } }
          : {}),
      */
    };

    const npmjs: NpmPublishOptions = {
      registry: tsProject.package.npmRegistry,
      npmTokenSecret: tsProject.package.npmTokenSecret,
      npmProvenance: tsProject.package.npmProvenance,
      // No support for CodeArtifact here
      // codeArtifactOptions: tsProject.codeArtifactOptions,
    };
    this.addTargetToBuild('js', this.packageJsTask, extraJobOptions);
    this.addTargetToRelease('js', this.packageJsTask, npmjs);

    const maven = options.publishToMaven;
    if (maven) {
      targets.java = {
        package: maven.javaPackage,
        maven: {
          groupId: maven.mavenGroupId,
          artifactId: maven.mavenArtifactId,
        },
      };

      const task = this.addPackagingTask('java');
      this.addTargetToBuild('java', task, extraJobOptions);
      this.addTargetToRelease('java', task, maven);
    }

    const pypi = options.publishToPypi;
    if (pypi) {
      targets.python = {
        distName: pypi.distName,
        module: pypi.module,
      };

      const task = this.addPackagingTask('python');
      this.addTargetToBuild('python', task, extraJobOptions);
      this.addTargetToRelease('python', task, pypi);
    }

    const nuget = options.publishToNuget;
    if (nuget) {
      targets.dotnet = {
        namespace: nuget.dotNetNamespace,
        packageId: nuget.packageId,
        iconUrl: nuget.iconUrl,
      };

      const task = this.addPackagingTask('dotnet');
      this.addTargetToBuild('dotnet', task, extraJobOptions);
      this.addTargetToRelease('dotnet', task, nuget);
    }

    const golang = options.publishToGo;
    if (golang) {
      targets.go = {
        moduleName: golang.moduleName,
        packageName: golang.packageName,
        versionSuffix: golang.versionSuffix,
      };

      const task = this.addPackagingTask('go');
      this.addTargetToBuild('go', task, extraJobOptions);
      this.addTargetToRelease('go', task, golang);
    }

    // If jsiiVersion is "*", don't specify anything so the user can manage.
    // Otherwise, use `jsiiVersion` or fall back to `5.7`
    const jsiiVersion = (options.jsiiVersion === '*' ? undefined : options.jsiiVersion) ?? '5.7';
    const jsiiSuffix = jsiiVersion ? `@${jsiiVersion}` : '';

    tsProject.addDevDeps(
      `jsii${jsiiSuffix}`,
      `jsii-rosetta${jsiiSuffix}`,
      'jsii-diff',
      'jsii-pacmak',
    );

    new Rosetta(project as any, {
      strict: true,
      version: jsiiVersion,
    });

    tsProject.gitignore.exclude('.jsii', 'tsconfig.json');
    tsProject.npmignore?.include('.jsii');

    if (options.docgen ?? true) {
      // If jsiiVersion is "*", don't specify anything so the user can manage.
      // Otherwise use a version that is compatible with all supported jsii releases.
      const docgenVersion = options.jsiiVersion === '*' ? '*' : '^10.5.0';
      new pj.cdk.JsiiDocgen(tsProject, {
        version: docgenVersion,
        filePath: options.docgenFilePath,
      });
    }

    // jsii updates .npmignore, so we make it writable
    if (tsProject.npmignore) {
      tsProject.npmignore.readonly = false;
    }

    const packageJson = tsProject.package.file;

    if ((options.pypiClassifiers ?? []).length > 0) {
      packageJson.patch(
        pj.JsonPatch.add('/jsii/targets/python/classifiers', options.pypiClassifiers),
      );
    }

    if (options.rosettaStrict) {
      packageJson.patch(
        pj.JsonPatch.add('/jsii/metadata', {}),
        pj.JsonPatch.add('/jsii/metadata/jsii', {}),
        pj.JsonPatch.add('/jsii/metadata/jsii/rosetta', {}),
        pj.JsonPatch.add('/jsii/metadata/jsii/rosetta/strict', true),
      );
    }
  }

  /**
   * Adds a target language to the release workflow.
   */
  private addTargetToRelease(
    language: JsiiPacmakTarget,
    packTask: pj.Task,
    target:
      | pj.cdk.JsiiPythonTarget
      | pj.cdk.JsiiDotNetTarget
      | pj.cdk.JsiiGoTarget
      | pj.cdk.JsiiJavaTarget
      | NpmPublishOptions,
  ) {
    const release = this.monorepoRelease.workspaceRelease(this.monoProject);

    const pacmak = this.pacmakForLanguage(language, packTask);
    const prePublishSteps = [
      ...pacmak.bootstrapSteps,
      pj.github.WorkflowSteps.checkout({
        with: {
          path: REPO_TEMP_DIRECTORY,
          ...(this.tsProject.github?.downloadLfs ? { lfs: true } : {}),
        },
      }),
      ...pacmak.packagingSteps,
    ];
    const commonPublishOptions: CommonPublishOptions = {
      publishTools: pacmak.publishTools,
      prePublishSteps,
    };

    const handler: PublishTo = publishTo[language];

    release.publisher?.[handler]({
      ...commonPublishOptions,
      ...target,
    });
  }

  /**
   * Adds a target language to the build workflow
   */
  private addTargetToBuild(
    language: JsiiPacmakTarget,
    packTask: pj.Task,
    extraJobOptions: Partial<Job>,
  ) {
    if (!this.tsProject.buildWorkflow) {
      return;
    }
    const pacmak = this.pacmakForLanguage(language, packTask);

    this.tsProject.buildWorkflow.addPostBuildJob(`package-${language}`, {
      ...pj.filteredRunsOnOptions(
        extraJobOptions.runsOn,
        extraJobOptions.runsOnGroup,
      ),
      permissions: {
        contents: JobPermission.READ,
      },
      tools: {
        // FIXME: We should get this from a global GitHub component
        node: { version: (this.tsProject as any).nodeVersion ?? 'lts/*' },
        ...pacmak.publishTools,
      },
      steps: [
        ...pacmak.bootstrapSteps,
        WorkflowSteps.checkout({
          with: {
            path: REPO_TEMP_DIRECTORY,
            ref: PULL_REQUEST_REF,
            repository: PULL_REQUEST_REPOSITORY,
            ...(this.tsProject.github?.downloadLfs ? { lfs: true } : {}),
          },
        }),
        ...pacmak.packagingSteps,
      ],
      ...extraJobOptions,
    });
  }

  private addPackagingTask(language: JsiiPacmakTarget): pj.Task {
    const packageTargetTask = this.tsProject.tasks.addTask(`package:${language}`, {
      description: `Create ${language} language bindings`,
    });
    const commandParts = ['jsii-pacmak', '-v'];

    if (this.tsProject.package.packageManager === NodePackageManager.PNPM) {
      commandParts.push("--pack-command 'pnpm pack'");
    }

    commandParts.push(`--target ${language}`);

    packageTargetTask.exec(commandParts.join(' '));

    this.packageAllTask.spawn(packageTargetTask);
    return packageTargetTask;
  }

  private pacmakForLanguage(
    target: JsiiPacmakTarget,
    packTask: pj.Task,
  ): {
      publishTools: Tools;
      bootstrapSteps: Array<Step>;
      packagingSteps: Array<Step>;
    } {
    const bootstrapSteps: Array<Step> = [];
    const packagingSteps: Array<Step> = [];

    // Generic bootstrapping for all target languages
    bootstrapSteps.push(...(this.tsProject as any).workflowBootstrapSteps);
    if (this.tsProject.package.packageManager === NodePackageManager.PNPM) {
      bootstrapSteps.push({
        name: 'Setup pnpm',
        uses: 'pnpm/action-setup@v3',
        with: { version: this.tsProject.package.pnpmVersion },
      });
    } else if (this.tsProject.package.packageManager === NodePackageManager.BUN) {
      bootstrapSteps.push({
        name: 'Setup bun',
        uses: 'oven-sh/setup-bun@v1',
      });
    }

    // Installation steps before packaging, but after checkout
    packagingSteps.push(
      {
        name: 'Install Dependencies',
        run: `cd ${REPO_TEMP_DIRECTORY} && ${this.tsProject.package.installCommand}`,
      },
      {
        name: 'Extract build artifact',
        run: `tar --strip-components=1 -xzvf ${this.tsProject.artifactsDirectory}/js/*.tgz -C ${REPO_TEMP_DIRECTORY}/${this.monoProject.workspaceDirectory}`,
      },
      {
        name: 'Move build artifact out of the way',
        run: `mv ${this.tsProject.artifactsDirectory} ${BUILD_ARTIFACT_OLD_DIR}`,
      },
      {
        name: `Create ${target} artifact`,
        run: `cd ${REPO_TEMP_DIRECTORY}/${this.monoProject.workspaceDirectory} && ${this.tsProject.runTaskCommand(packTask)}`,
      },
      {
        name: `Collect ${target} artifact`,
        run: `mv ${REPO_TEMP_DIRECTORY}/${this.monoProject.workspaceDirectory}/${this.tsProject.artifactsDirectory} ${this.tsProject.artifactsDirectory}`,
      },
    );

    return {
      publishTools: JSII_TOOLCHAIN[target],
      bootstrapSteps,
      packagingSteps,
    };
  }
}

type PublishTo = keyof pj.release.Publisher &
  (
    | 'publishToNpm'
    | 'publishToMaven'
    | 'publishToPyPi'
    | 'publishToNuget'
    | 'publishToGo'
  );

type PublishToTarget = { [K in JsiiPacmakTarget]: PublishTo };
const publishTo: PublishToTarget = {
  js: 'publishToNpm',
  java: 'publishToMaven',
  python: 'publishToPyPi',
  dotnet: 'publishToNuget',
  go: 'publishToGo',
};

export type JsiiPacmakTarget = 'js' | 'go' | 'java' | 'python' | 'dotnet';

/**
 * GitHub workflow job steps for setting up the tools required for various JSII targets.
 */
export const JSII_TOOLCHAIN: Record<JsiiPacmakTarget, Tools> = {
  js: {},
  java: { java: { version: '11' } },
  python: { python: { version: '3.x' } },
  go: { go: { version: '^1.18.0' } },
  dotnet: { dotnet: { version: '6.x' } },
};

const REPO_TEMP_DIRECTORY = '.repo';
const BUILD_ARTIFACT_OLD_DIR = 'dist.old';

export const PULL_REQUEST_REF = '${{ github.event.pull_request.head.ref }}';
export const PULL_REQUEST_REPOSITORY =
  '${{ github.event.pull_request.head.repo.full_name }}';
