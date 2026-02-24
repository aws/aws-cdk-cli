import * as path from 'path';
import { yarn } from 'cdklabs-projen-project-types';
import { TypeScriptWorkspace, type TypeScriptWorkspaceOptions } from 'cdklabs-projen-project-types/lib/yarn';
import * as pj from 'projen';
import { AdcPublishing } from './projenrc/adc-publishing';
import { BootstrapTemplateProtection } from './projenrc/bootstrap-template-protection';
import { BundleCli } from './projenrc/bundle';
import { CdkCliIntegTestsWorkflow, fixupTestTask } from './projenrc/cdk-cli-integ-tests';
import { CodeCovWorkflow } from './projenrc/codecov';
import { configureEslint } from './projenrc/eslint';
import { IssueLabeler } from './projenrc/issue-labeler';
import { JsiiBuild } from './projenrc/jsii';
import { LargePrChecker } from './projenrc/large-pr-checker';
import { PrLabeler } from './projenrc/pr-labeler';
import { RecordPublishingTimestamp } from './projenrc/record-publishing-timestamp';
import { DocType, S3DocsPublishing } from './projenrc/s3-docs-publishing';
import { SelfMutationOnForks } from './projenrc/SelfMutationOnForks';
import { TypecheckTests } from './projenrc/TypecheckTests';

// #region shared config

const TYPESCRIPT_VERSION = '5.9';

/**
 * Global note on customizeReference
 * ---------------------------------
 *
 * All packages references using `customizeReference()` should have an `^0.0.0`
 * dependency in `package.json` regardless of what the argument to
 * `customizeReference()` is. This because unbump will always set the range
 * specified to that value, and if it used to be something else then we will
 * introduce a git diff that stops the release. Do not worry, the bumped version
 * will have the correct range character.
 *
 * When adding a fresh package, projen sometimes inserts `"0.0.0"` there, if
 * that happens you need to edit `package.json` once by hand.
 */

/**
 * When adding an SDK dependency for a library, use this function
 *
 * It forces the package.json to contain `@^3`; if we don't force that, projen
 * will make it contain something like `^3.282.74` and update that version every
 * couple of days.
 *
 * By forcing a large range, we provide ample opportunity for our library user's
 * package manager to deduplicate whatever version of SDKv3 the consumer is
 * using with the version that our library expects.
 */
function sdkDepForLib(name: string) {
  if (!name.startsWith('@aws-sdk/')) {
    throw new Error('Must be an SDK package');
  }
  return `${name}@^3`;
}

/**
 * Same as `sdkDepForLib`, but for smithy
 */
function smithyDepForLib(name: string) {
  if (!name.startsWith('@smithy/')) {
    throw new Error('Must be a Smithy package');
  }
  return `${name}@^4`;
}

const BUNDLED_LICENSES = [
  'Apache-2.0',
  'MIT',
  'BSD-3-Clause',
  'ISC',
  'BSD-2-Clause',
  '0BSD',
  'MIT OR Apache-2.0',
];

/**
 * Configures a Eslint, which is a complex setup.
 *
 * We also need to override the built-in prettier dependency to prettier@2, because
 * Jest < 30 can only work with prettier 2 (https://github.com/jestjs/jest/issues/14305)
 * and 30 is not stable yet.
 */
function configureProject<A extends pj.typescript.TypeScriptProject>(x: A): A {
  // currently supported min node version
  x.package.addEngine('node', '>= 18.0.0');

  x.addDevDeps(
    'jest-junit@^16',
    'prettier@^2.8',
  );

  configureEslint(x);

  x.npmignore?.addPatterns(
    // don't inlcude config files
    '.eslintrc.js',
    // As a rule we don't include .ts sources in the NPM package
    '*.ts',
    '!*.d.ts',
    // Never include the build-tools directory
    'build-tools',
  );

  if (x instanceof TypeScriptWorkspace) {
    // Individual workspace packages shouldn't depend on "projen", it gets brought in at the monorepo root
    x.deps.removeDependency('projen');
  }

  return x;
}

const POWERFUL_RUNNER = 'aws-cdk_ubuntu-latest_16-core';

// Ignore patterns that apply both to the Toolkit CLI and Library
const ADDITIONAL_CLI_IGNORE_PATTERNS = [
  'db.json.gz',
  '.init-version.json',
  'index_bg.wasm',
  'build-info.json',
  '.recommended-feature-flags.json',
  'synth.lock',
];

const defaultTsOptions: NonNullable<TypeScriptWorkspaceOptions['tsconfig']>['compilerOptions'] = {
  target: 'ES2020',
  module: 'commonjs',
  lib: ['es2020'],
  incremental: true,
  esModuleInterop: false,
  skipLibCheck: true,
  isolatedModules: true,
};

/**
 * Shared jest config
 *
 * Must be a function because these structures will be mutated in-place inside projen
 */
function sharedJestConfig(): pj.javascript.JestConfigOptions {
  return {
    moduleFileExtensions: [
      // .ts first to prefer a ts over a js if present
      'ts',
      'js',
    ],
    maxWorkers: '80%',
    testEnvironment: 'node',
    coverageThreshold: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
    collectCoverage: true,
    coverageReporters: [
      'text-summary', // for console summary
      'cobertura', // for codecov. see https://docs.codecov.com/docs/code-coverage-with-javascript
      ['html', { subdir: 'html-report' }] as any, // for local deep dive
    ],
    testMatch: ['<rootDir>/test/**/?(*.)+(test).ts'],
    coveragePathIgnorePatterns: ['\\.generated\\.[jt]s$', '<rootDir>/test/', '.warnings.jsii.js$', '/node_modules/'],
    reporters: ['default', ['jest-junit', { suiteName: 'jest tests', outputDirectory: 'coverage' }]] as any,

    // Randomize test order: this will catch tests that accidentally pass or
    // fail because they rely on shared mutable state left by other tests
    // (files on disk, global mocks, etc).
    randomize: true,
  };
}

/**
 * Extend default jest options for a project
 */
function jestOptionsForProject(options: pj.javascript.JestOptions): pj.javascript.JestOptions {
  const generic = genericCdkProps().jestOptions;
  return {
    ...generic,
    ...options,
    jestConfig: {
      ...generic.jestConfig,
      ...(options.jestConfig ?? {}),
      coveragePathIgnorePatterns: [
        ...(generic.jestConfig?.coveragePathIgnorePatterns ?? []),
        ...(options.jestConfig?.coveragePathIgnorePatterns ?? []),
      ],
      coverageThreshold: {
        ...(generic.jestConfig?.coverageThreshold ?? {}),
        ...(options.jestConfig?.coverageThreshold ?? {}),
      },
    },
  };
}

function transitiveFeaturesAndFixes(thisPkg: string, depPkgs: string[]) {
  return pj.ReleasableCommits.featuresAndFixes([
    '.',
    ...depPkgs.map(p => path.relative(`packages/${thisPkg}`, `packages/${p}`)),
  ].join(' '));
}

/**
 * Returns all packages that are considered part of the toolkit,
 * as relative paths from the provided package.
 */
function transitiveToolkitPackages(thisPkg: string) {
  const toolkitPackages = [
    'aws-cdk',
    '@aws-cdk/cloud-assembly-schema',
    '@aws-cdk/cloud-assembly-api',
    '@aws-cdk/cloudformation-diff',
    '@aws-cdk/toolkit-lib',
  ];

  return transitiveFeaturesAndFixes(thisPkg, toolkitPackages.filter(name => name !== thisPkg));
}

// #endregion
//////////////////////////////////////////////////////////////////////
// #region Monorepo

const repoProject = new yarn.Monorepo({
  projenrcTs: true,
  name: 'aws-cdk-cli',
  description: "Monorepo for the AWS CDK's CLI",
  repository: 'https://github.com/aws/aws-cdk-cli',

  defaultReleaseBranch: 'main',
  typescriptVersion: TYPESCRIPT_VERSION,
  devDeps: [
    'cdklabs-projen-project-types',
    'fast-glob',
    'semver',
    '@aws-sdk/client-s3',
    '@aws-sdk/credential-providers',
    '@aws-sdk/lib-storage',
  ],
  vscodeWorkspace: true,
  vscodeWorkspaceOptions: {
    includeRootWorkspace: true,
  },
  nx: true,
  buildWithNx: true,

  eslintOptions: {
    dirs: ['lib'],
    devdirs: ['test'],
  },

  workflowNodeVersion: 'lts/*',
  workflowRunsOn: [POWERFUL_RUNNER],
  gitignore: ['.DS_Store', '.tools'],

  autoApproveUpgrades: true,
  autoApproveOptions: {
    allowedUsernames: ['aws-cdk-automation', 'dependabot[bot]'],
  },

  release: true,
  releaseOptions: {
    publishToNpm: true,
    releaseTrigger: pj.release.ReleaseTrigger.workflowDispatch(),
  },

  depsUpgradeOptions: {
    workflowOptions: {
      schedule: pj.javascript.UpgradeDependenciesSchedule.WEEKLY,
    },
  },

  githubOptions: {
    projenCredentials: pj.github.GithubCredentials.fromPersonalAccessToken({
      secret: 'PROJEN_GITHUB_TOKEN',
      environment: 'automation',
    }),
    mergify: false,
    mergeQueue: true,
    mergeQueueOptions: {
      autoQueueOptions: {
        // Only autoqueue for PRs targeting the 'main' branch
        targetBranches: ['main'],
      },
    },
    pullRequestLint: true,
    pullRequestLintOptions: {
      contributorStatement: 'By submitting this pull request, I confirm that my contribution is made under the terms of the Apache-2.0 license',
      contributorStatementOptions: {
        exemptUsers: ['aws-cdk-automation', 'dependabot[bot]'],
      },
      semanticTitleOptions: {
        types: ['feat', 'fix', 'chore', 'refactor', 'test', 'docs', 'revert'],
        scopes: [], // actually set at the bottom of the file to be based on monorepo packages
      },
    },
  },

  pullRequestTemplateContents: [
    'Fixes #',
    '',
    '### Checklist',
    '- [ ] This change contains a major version upgrade for a dependency and I confirm all breaking changes are addressed',
    '  - Release notes for the new version:',
  ],

  buildWorkflowOptions: {
    preBuildSteps: [
      // Need this for the init tests
      {
        name: 'Set git identity',
        run: [
          'git config --global user.name "aws-cdk-cli"',
          'git config --global user.email "noreply@example.com"',
        ].join('\n'),
      },
    ],
  },
});

new AdcPublishing(repoProject);
new RecordPublishingTimestamp(repoProject);
new BootstrapTemplateProtection(repoProject);
new SelfMutationOnForks(repoProject, { environment: 'automation' });

repoProject.gitignore.addPatterns('.vscode/settings.json');

// Eslint for projen config
// @ts-ignore
repoProject.eslint = new pj.javascript.Eslint(repoProject, {
  tsconfigPath: `./${repoProject.tsconfigDev.fileName}`,
  dirs: [],
  devdirs: ['projenrc', '.projenrc.ts'],
  fileExtensions: ['.ts', '.tsx'],
  lintProjenRc: false,
});

// always lint projen files as part of the build
if (repoProject.eslint?.eslintTask) {
  repoProject.tasks.tryFind('build')?.spawn(repoProject.eslint?.eslintTask);
}

// always scan for git secrets before building
const gitSecretsScan = repoProject.addTask('git-secrets-scan', {
  steps: [
    {
      exec: '/bin/bash ./projenrc/git-secrets-scan.sh',
    },
  ],
});

repoProject.tasks.tryFind('build')!.spawn(gitSecretsScan);

new AdcPublishing(repoProject);

const repo = configureProject(repoProject);

interface GenericProps {
  private?: boolean;
}

/**
 * Generic CDK props
 *
 * Must be a function because the structures of jestConfig will be mutated
 * in-place inside projen
 */
function genericCdkProps(props: GenericProps = {}) {
  return {
    keywords: ['aws', 'cdk'],
    homepage: 'https://github.com/aws/aws-cdk',
    authorName: 'Amazon Web Services',
    authorUrl: 'https://aws.amazon.com',
    authorOrganization: true,
    releasableCommits: pj.ReleasableCommits.featuresAndFixes('.'),
    releaseEnvironment: 'releasing',
    npmTrustedPublishing: true,
    jestOptions: {
      configFilePath: 'jest.config.json',
      junitReporting: false,
      coverageText: false,
      jestConfig: sharedJestConfig(),
      preserveDefaultReporters: false,
    },
    minNodeVersion: '16.0.0',
    prettierOptions: {
      settings: {
        printWidth: 120,
        singleQuote: true,
        trailingComma: pj.javascript.TrailingComma.ALL,
      },
    },
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
      },
    },
    typescriptVersion: TYPESCRIPT_VERSION,
    checkLicenses: props.private ? undefined : {
      allow: ['Apache-2.0', 'MIT', 'ISC', 'BSD-3-Clause', '0BSD'],
    },
    ...props,
  } satisfies Partial<yarn.TypeScriptWorkspaceOptions>;
}

// #endregion
//////////////////////////////////////////////////////////////////////
// #region @aws-cdk/cloud-assembly-schema

const cloudAssemblySchema = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/cloud-assembly-schema',
    description: 'Schema for the protocol between CDK framework and CDK CLI',
    srcdir: 'lib',
    bundledDeps: ['jsonschema@~1.4.1', 'semver'],
    devDeps: ['@types/semver', 'mock-fs', 'typescript-json-schema', 'tsx'],
    disableTsconfig: true,

    jestOptions: jestOptionsForProject({
      jestConfig: {
        coverageThreshold: {
          functions: 75,
        },
      },
    }),

    // Append a specific version string for testing
    nextVersionCommand: 'tsx ../../../projenrc/next-version.ts majorFromRevision:schema/version.json maybeRc',
  }),
);
fixupTestTask(cloudAssemblySchema);

new JsiiBuild(cloudAssemblySchema, {
  docgen: false,
  jsiiVersion: TYPESCRIPT_VERSION,
  excludeTypescript: ['**/test/**/*.ts'],
  publishToMaven: {
    javaPackage: 'software.amazon.awscdk.cloudassembly.schema',
    mavenArtifactId: 'cdk-cloud-assembly-schema',
    mavenGroupId: 'software.amazon.awscdk',
    mavenServerId: 'central-ossrh',
  },
  publishToNuget: {
    dotNetNamespace: 'Amazon.CDK.CloudAssembly.Schema',
    packageId: 'Amazon.CDK.CloudAssembly.Schema',
    iconUrl: 'https://raw.githubusercontent.com/aws/aws-cdk/main/logo/default-256-dark.png',
  },
  publishToPypi: {
    distName: 'aws-cdk.cloud-assembly-schema',
    module: 'aws_cdk.cloud_assembly_schema',
    trustedPublishing: true,
  },
  pypiClassifiers: [
    'Framework :: AWS CDK',
    'Framework :: AWS CDK :: 2',
  ],
  publishToGo: {
    moduleName: 'github.com/cdklabs/cloud-assembly-schema-go',
  },
  composite: true,
});

(() => {
  cloudAssemblySchema.preCompileTask.exec('tsx projenrc/update.ts');

  // This file will be generated at release time. It needs to be gitignored or it will
  // fail projen's "no tamper" check, which means it must also be generated every build time.
  //
  // Crucially, this must also run during release after bumping, but that is satisfied already
  // by making it part of preCompile, because that makes it run as part of projen build.
  cloudAssemblySchema.preCompileTask.exec('tsx ../../../projenrc/copy-cli-version-to-assembly.task.ts');
  cloudAssemblySchema.gitignore.addPatterns('cli-version.json');

  cloudAssemblySchema.addPackageIgnore('*.ts');
  cloudAssemblySchema.addPackageIgnore('!*.d.ts');
  cloudAssemblySchema.addPackageIgnore('**/scripts');
})();

// #endregion
//////////////////////////////////////////////////////////////////////
// #region @aws-cdk/cloudformation-diff

const cloudFormationDiff = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/cloudformation-diff',
    description: 'Utilities to diff CDK stacks against CloudFormation templates',
    majorVersion: 2,
    srcdir: 'lib',
    devDeps: [
      'fast-check',
    ],
    peerDeps: [
      sdkDepForLib('@aws-sdk/client-cloudformation'),
    ],
    deps: [
      '@aws-cdk/aws-service-spec',
      '@aws-cdk/service-spec-types',
      'chalk@^4',
      'diff',
      'fast-deep-equal',
      'string-width@^4',
      'table@^6',
    ],
    // FIXME: this should be a jsii project
    // (EDIT: or should it? We're going to bundle it into aws-cdk-lib)
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
      },
    },

    jestOptions: jestOptionsForProject({
      jestConfig: {
        coverageThreshold: {
          functions: 75,
        },
      },
    }),

    // Append a specific version string for testing
    nextVersionCommand: 'tsx ../../../projenrc/next-version.ts maybeRc',
  }),
);

fixupTestTask(cloudFormationDiff);

// #endregion

//////////////////////////////////////////////////////////////////////
// #region @aws-cdk/cloud-assembly-api

const cloudAssemblyApi = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/cloud-assembly-api',
    description: 'API for working with Cloud Assemblies',
    srcdir: 'lib',
    bundledDeps: ['jsonschema@~1.4.1', 'semver'],
    devDeps: [
      cloudAssemblySchema.customizeReference({ versionType: 'exact' }),
    ],
    peerDeps: [
      cloudAssemblySchema.customizeReference({ versionType: 'any-future' }),
    ],

    jestOptions: jestOptionsForProject({
      jestConfig: {
        coverageThreshold: {
          functions: 75,
        },
      },
    }),

    // Append a specific version string for testing
    nextVersionCommand: 'tsx ../../../projenrc/next-version.ts atLeast:2.0.0 maybeRc',
  }),
);
fixupTestTask(cloudAssemblyApi);

// #endregion

//////////////////////////////////////////////////////////////////////
// #region @aws-cdk/cx-api

// cx-api represents the flags that the Cloud Executable expects. It is
// generated from `aws-cdk-lib` at build time.  Stay within the same MV,
// otherwise any should work
const cxApi = '@aws-cdk/cx-api@^2';

// #endregion
//////////////////////////////////////////////////////////////////////
// #region @aws-cdk/yarn-cling

const yarnCling = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps({
      private: true,
    }),
    parent: repo,
    name: '@aws-cdk/yarn-cling',
    description: 'Tool for generating npm-shrinkwrap from yarn.lock',
    srcdir: 'lib',
    deps: ['@yarnpkg/lockfile', 'semver'],
    devDeps: ['@types/semver', '@types/yarnpkg__lockfile', 'fast-check'],
    minNodeVersion: '18',
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
      },
    },
    jestOptions: jestOptionsForProject({
      jestConfig: {
        coverageThreshold: {
          branches: 78,
        },
      },
    }),
  }),
);
yarnCling.testTask.prependExec('ln -sf ../../cdk test/test-fixture/jsii/node_modules/');

// #endregion
//////////////////////////////////////////////////////////////////////
// #region @aws-cdk/user-input-gen

const yargsGen = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps({
      private: true,
    }),
    parent: repo,
    name: '@aws-cdk/user-input-gen',
    description: 'Generate CLI arguments',
    srcdir: 'lib',
    deps: ['@cdklabs/typewriter', 'prettier@^2.8', 'lodash.clonedeep'],
    devDeps: ['@types/semver', '@types/yarnpkg__lockfile', '@types/lodash.clonedeep', '@types/prettier@^2'],
    minNodeVersion: '17.0.0', // Necessary for 'structuredClone'
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
      },
    },
  }),
);

// #endregion
//////////////////////////////////////////////////////////////////////
// #region @aws-cdk/cli-plugin-contract

// This should be deprecated, but only after the move
const cliPluginContract = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/cli-plugin-contract',
    description: 'Contract between the CLI and authentication plugins, for the exchange of AWS credentials',
    majorVersion: 2,
    srcdir: 'lib',
    deps: [
    ],
    devDeps: [
    ],
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
      },
    },
  }),
);

// #endregion
//////////////////////////////////////////////////////////////////////
// #region @aws-cdk/cdk-assets-lib

const cdkAssetsLib = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/cdk-assets-lib',
    majorVersion: 1,
    description: 'CDK Asset Publishing Library',
    srcdir: 'lib',
    deps: [
      cloudAssemblySchema.customizeReference({ versionType: 'any-future' }),
      cxApi,
      cloudAssemblyApi.customizeReference({ versionType: 'exact' }),
      'archiver',
      'fast-glob',
      'mime@^2',
      sdkDepForLib('@aws-sdk/client-ecr'),
      sdkDepForLib('@aws-sdk/client-s3'),
      sdkDepForLib('@aws-sdk/client-secrets-manager'),
      sdkDepForLib('@aws-sdk/client-sts'),
      sdkDepForLib('@aws-sdk/credential-providers'),
      sdkDepForLib('@aws-sdk/lib-storage'),
      smithyDepForLib('@smithy/config-resolver'),
      smithyDepForLib('@smithy/node-config-provider'),
      'picomatch',
    ],
    devDeps: [
      '@types/archiver',
      '@types/mime@^2',
      '@types/picomatch',
      'fs-extra',
      'graceful-fs',
      'jszip',
      '@types/mock-fs@^4',
      'mock-fs@^5',
      'aws-sdk-client-mock',
      'aws-sdk-client-mock-jest',
    ],
    tsconfigDev: {
      compilerOptions: {
        ...defaultTsOptions,
      },
      include: ['bin/**/*.ts'],
    },
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
        rootDir: undefined,
        outDir: undefined,
      },
      include: ['bin/**/*.ts'],
    },
    jestOptions: jestOptionsForProject({
      jestConfig: {
        // We have many tests here that commonly time out
        testTimeout: 10_000,
      },
    }),

    // Append a specific version string for testing
    nextVersionCommand: 'tsx ../../../projenrc/next-version.ts neverMajor maybeRc',

    releasableCommits: transitiveFeaturesAndFixes('@aws-cdk/cdk-assets-lib', [
      '@aws-cdk/cloud-assembly-schema',
    ]),
  }),
);
fixupTestTask(cdkAssetsLib);

// Prevent imports of private API surface
cdkAssetsLib.package.addField('exports', {
  '.': {
    types: './lib/index.d.ts',
    default: './lib/index.js',
  },
  './package.json': './package.json',
});

new TypecheckTests(cdkAssetsLib);

cdkAssetsLib.gitignore.addPatterns(
  '*.js',
  '*.d.ts',
);

// This package happens do something only slightly naughty
cdkAssetsLib.eslint?.addRules({ 'jest/no-export': ['off'] });

// #endregion
//////////////////////////////////////////////////////////////////////
// #region cdk-assets

const cdkAssetsCli = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: 'cdk-assets',
    description: 'CDK Asset Publishing Tool',
    majorVersion: 4,
    srcdir: 'lib',
    deps: [
      cdkAssetsLib,
      'yargs',
    ],
    devDeps: [
      '@types/yargs',
      // These are for tests
      cloudAssemblySchema,
      '@aws-sdk/client-s3',
      'aws-sdk-client-mock',
    ],
    tsconfigDev: {
      compilerOptions: {
        ...defaultTsOptions,
      },
      include: ['bin/**/*.ts'],
    },
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
        rootDir: undefined,
        outDir: undefined,
      },
      include: ['bin/**/*.ts'],
    },

    jestOptions: jestOptionsForProject({
      jestConfig: {
        // We have many tests here that commonly time out
        testTimeout: 10_000,
        coverageThreshold: {
          branches: 74,
        },
      },
    }),

    // Append a specific version string for testing
    nextVersionCommand: 'tsx ../../projenrc/next-version.ts maybeRc',

    releasableCommits: transitiveFeaturesAndFixes('cdk-assets', [
      '@aws-cdk/cdk-assets-lib',
      '@aws-cdk/cloud-assembly-schema',
    ]),
  }),
);

fixupTestTask(cdkAssetsCli);

cdkAssetsCli.gitignore.addPatterns(
  '*.js',
  '*.d.ts',
);

new BundleCli(cdkAssetsCli, {
  allowedLicenses: BUNDLED_LICENSES,
  dontAttribute: '^@aws-cdk/|^@cdklabs/$',
  test: 'bin/cdk-assets --version',
  entryPoints: [
    'bin/cdk-assets.js',
    'bin/docker-credential-cdk-assets.js',
  ],
  minifyWhitespace: true,
});

// #endregion
//////////////////////////////////////////////////////////////////////
// #region @aws-cdk/toolkit-lib

const TOOLKIT_LIB_EXCLUDE_PATTERNS = [
  'lib/init-templates/*/typescript/*/*.template.ts',
];

const toolkitLibTsCompilerOptions = {
  ...defaultTsOptions,
  target: 'es2022',
  lib: ['es2022', 'esnext.disposable'],
  module: 'NodeNext',
  declarationMap: true,
};

const toolkitLib = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    homepage: 'https://docs.aws.amazon.com/cdk/api/toolkit-lib',
    parent: repo,
    name: '@aws-cdk/toolkit-lib',
    description: 'AWS CDK Programmatic Toolkit Library',
    majorVersion: 1,
    srcdir: 'lib',
    peerDeps: [
      cliPluginContract.customizeReference({ versionType: 'any-minor' }), // allow consumers to easily de-depulicate this
    ],
    deps: [
      cloudAssemblySchema.customizeReference({ versionType: 'any-future' }), // needs to be newer than what this was build with
      cloudFormationDiff.customizeReference({ versionType: 'any-minor' }), // stay within the same MV, otherwise any should work
      cdkAssetsLib.customizeReference({ versionType: 'any-minor' }), // stay within the same MV, otherwise any should work
      cxApi,
      cloudAssemblyApi.customizeReference({ versionType: 'exact' }),
      sdkDepForLib('@aws-sdk/client-appsync'),
      sdkDepForLib('@aws-sdk/client-bedrock-agentcore-control'),
      sdkDepForLib('@aws-sdk/client-cloudformation'),
      sdkDepForLib('@aws-sdk/client-cloudwatch-logs'),
      sdkDepForLib('@aws-sdk/client-cloudcontrol'),
      sdkDepForLib('@aws-sdk/client-codebuild'),
      sdkDepForLib('@aws-sdk/client-ec2'),
      sdkDepForLib('@aws-sdk/client-ecr'),
      sdkDepForLib('@aws-sdk/client-ecs'),
      sdkDepForLib('@aws-sdk/client-elastic-load-balancing-v2'),
      sdkDepForLib('@aws-sdk/client-iam'),
      sdkDepForLib('@aws-sdk/client-kms'),
      sdkDepForLib('@aws-sdk/client-lambda'),
      sdkDepForLib('@aws-sdk/client-route-53'),
      sdkDepForLib('@aws-sdk/client-s3'),
      sdkDepForLib('@aws-sdk/client-secrets-manager'),
      sdkDepForLib('@aws-sdk/client-sfn'),
      sdkDepForLib('@aws-sdk/client-ssm'),
      sdkDepForLib('@aws-sdk/client-sts'),
      sdkDepForLib('@aws-sdk/credential-providers'),
      sdkDepForLib('@aws-sdk/ec2-metadata-service'),
      sdkDepForLib('@aws-sdk/lib-storage'),
      smithyDepForLib('@smithy/middleware-endpoint'),
      smithyDepForLib('@smithy/property-provider'),
      smithyDepForLib('@smithy/shared-ini-file-loader'),
      smithyDepForLib('@smithy/util-retry'),
      smithyDepForLib('@smithy/util-waiter'),
      'archiver',
      'cdk-from-cfn',
      'chalk@^4',
      'chokidar@^4',
      'fast-deep-equal',
      'fs-extra@^9',
      'picomatch',
      'p-limit@^3',
      'semver',
      'split2',
      'fast-glob',
      'uuid',
      'wrap-ansi@^7', // Last non-ESM version
      'yaml@^1',
    ],
    devDeps: [
      '@aws-cdk/aws-service-spec',
      '@jest/environment',
      '@jest/globals',
      '@jest/types',
      '@microsoft/api-extractor',
      '@smithy/util-stream',
      '@types/fs-extra',
      '@types/picomatch',
      '@types/split2',
      'aws-cdk-lib',
      'aws-sdk-client-mock',
      'aws-sdk-client-mock-jest',
      'fast-check',
      'jest-environment-node',
      '@types/jest-when',
      'jest-when',
      'nock@13',
      'xml-js',
    ],
    // Watch 2 directories at once
    releasableCommits: transitiveToolkitPackages('@aws-cdk/toolkit-lib'),
    eslintOptions: {
      dirs: ['lib'],
      ignorePatterns: [
        ...TOOLKIT_LIB_EXCLUDE_PATTERNS,
        '*.d.ts',
      ],
    },
    jestOptions: jestOptionsForProject({
      jestConfig: {
        // Tests that synth an assembly usually need a bit longer
        testTimeout: 10_000,
        coverageThreshold: {
          statements: 87,
          branches: 83,
          functions: 82,
          lines: 87,
        },
        testEnvironment: './test/_helpers/jest-bufferedconsole.ts',
        setupFilesAfterEnv: [
          '<rootDir>/test/_helpers/jest-setup-after-env.ts',
          '<rootDir>/test/_helpers/jest-custom-matchers.ts',
        ],
      },
    }),
    tsconfig: {
      compilerOptions: {
        ...toolkitLibTsCompilerOptions,
      },
    },
    tsconfigDev: {
      compilerOptions: {
        ...toolkitLibTsCompilerOptions,
        rootDir: '.', // shouldn't be required but something broke... check again once we have gotten rid of the tmpToolkitHelpers package
      },
    },
    nextVersionCommand: 'tsx ../../../projenrc/next-version.ts maybeRc',
  }),
);
fixupTestTask(toolkitLib);
toolkitLib.tasks.tryFind('test')?.updateStep(0, {
  // https://github.com/aws/aws-sdk-js-v3/issues/7420
  exec: 'NODE_OPTIONS="$NODE_OPTIONS --experimental-vm-modules" jest --passWithNoTests --updateSnapshot',
});

new TypecheckTests(toolkitLib);

// API Extractor documentation publishing
new S3DocsPublishing(toolkitLib, {
  docsStream: 'toolkit-lib-api-model',
  artifactPath: 'api-extractor-docs.zip',
  bucketName: '${{ vars.DOCS_BUCKET_NAME }}',
  roleToAssume: '${{ vars.PUBLISH_TOOLKIT_LIB_DOCS_ROLE_ARN }}',
  docType: DocType.API_EXTRACTOR,
});

// Add API Extractor configuration
new pj.JsonFile(toolkitLib, 'api-extractor.json', {
  marker: false,
  obj: {
    projectFolder: '.',
    mainEntryPointFilePath: '<projectFolder>/lib/index.d.ts',
    bundledPackages: [],
    apiReport: {
      enabled: false,
    },
    docModel: {
      enabled: true,
      apiJsonFilePath: './dist/<unscopedPackageName>.api.json',
      projectFolderUrl: 'https://github.com/aws/aws-cdk-cli/tree/main/packages/%40aws-cdk/toolkit-lib',
    },
    dtsRollup: {
      enabled: false,
    },
    tsdocMetadata: {
      enabled: false,
    },
    messages: {
      compilerMessageReporting: {
        default: {
          logLevel: 'error',
        },
      },
      extractorMessageReporting: {
        'default': {
          logLevel: 'error',
        },
        'ae-missing-release-tag': {
          logLevel: 'none',
        },
        'ae-forgotten-export': {
          logLevel: 'error',
        },
      },
      tsdocMessageReporting: {
        default: {
          logLevel: 'error',
        },
      },
    },
  },
  committed: true,
});

// TsDoc config (required by API Extractor)
new pj.JsonFile(toolkitLib, 'tsdoc.json', {
  marker: false,
  obj: {
    $schema: 'https://developer.microsoft.com/json-schemas/tsdoc/v0/tsdoc.schema.json',
    // Inherit the TSDoc configuration for API Extractor
    extends: ['@microsoft/api-extractor/extends/tsdoc-base.json'],
    // custom config
    tagDefinitions: [
      {
        tagName: '@default',
        syntaxKind: 'block',
      },
      {
        tagName: '@module',
        syntaxKind: 'block',
      },
    ],
    supportForTags: {
      '@default': true,
      '@module': true,
    },
  },
});

// Eslint rules
toolkitLib.eslint?.addRules({
  '@cdklabs/no-throw-default-error': 'error',
});
toolkitLib.eslint?.addOverride({
  files: ['./test/**'],
  rules: {
    '@cdklabs/no-throw-default-error': 'off',
    '@typescript-eslint/unbound-method': 'off',
  },
});

// Prevent imports of private API surface
toolkitLib.package.addField('exports', {
  '.': {
    types: './lib/index.d.ts',
    default: './lib/index.js',
  },
  './package.json': './package.json',
});

const registryTask = toolkitLib.addTask('registry', { exec: 'tsx scripts/gen-code-registry.ts' });
toolkitLib.postCompileTask.spawn(registryTask);
toolkitLib.postCompileTask.exec('build-tools/build-info.sh');
toolkitLib.postCompileTask.exec('node build-tools/bundle.mjs');
// Smoke test exported js files
toolkitLib.postCompileTask.exec('node ./lib/index.js >/dev/null 2>/dev/null </dev/null');

// Do include all .ts files inside init-templates
toolkitLib.npmignore?.addPatterns(
  'assets',
  'docs',
  'docs_html',
  '*.d.ts.map',
  // Explicitly allow all required files
  '!build-info.json',
  '!db.json.gz',
  '!lib/init-templates/**/*.ts',
  '!lib/api/bootstrap/bootstrap-template.yaml',
  '!lib/*.js',
  '!lib/*.d.ts',
  '!LICENSE',
  '!NOTICE',
  '!THIRD_PARTY_LICENSES',
);

toolkitLib.gitignore.addPatterns(
  ...ADDITIONAL_CLI_IGNORE_PATTERNS,
  'docs_html',
  'build-info.json',
  'lib/**/*.wasm',
  'lib/**/*.yaml',
  'lib/**/*.yml',
  'lib/**/*.js.map',
  'lib/init-templates/**',
  '!test/_fixtures/**/app.js',
  '!test/_fixtures/**/cdk.out',
);

// Add commands for the API Extractor docs
const apiExtractorDocsTask = toolkitLib.addTask('docs', {
  exec: [
    // Run api-extractor to generate the API model
    'api-extractor run',
    // Create a directory for the API model
    'mkdir -p dist/api-extractor-docs/cdk/api/toolkit-lib',
    // Copy the API model to the directory (with error handling)
    'if [ -f dist/toolkit-lib.api.json ]; then cp dist/toolkit-lib.api.json dist/api-extractor-docs/cdk/api/toolkit-lib/; else echo "Warning: API JSON file not found"; fi',
    // Add version file
    '(cat dist/version.txt 2>/dev/null || echo "latest") > dist/api-extractor-docs/cdk/api/toolkit-lib/VERSION',
    // Copy README.md if it exists
    'if [ -f README.md ]; then cp README.md dist/api-extractor-docs/cdk/api/toolkit-lib/; fi',
    // Copy all files from docs directory if it exists
    'if [ -d docs ]; then mkdir -p dist/api-extractor-docs/cdk/api/toolkit-lib/docs && cp -r docs/* dist/api-extractor-docs/cdk/api/toolkit-lib/docs/; fi',
    // Copy all files from assets directory if it exists
    'if [ -d assets ]; then mkdir -p dist/api-extractor-docs/cdk/api/toolkit-lib/assets && cp -r assets/* dist/api-extractor-docs/cdk/api/toolkit-lib/assets/; fi',
    // Zip the API model and docs files
    'cd dist/api-extractor-docs && zip -r -q ../api-extractor-docs.zip cdk',
  ].join(' && '),
});
// Add the API Extractor docs task to the package task
toolkitLib.packageTask.spawn(apiExtractorDocsTask);

toolkitLib.addTask('publish-local', {
  exec: './build-tools/package.sh',
  receiveArgs: true,
});

// #endregion
//////////////////////////////////////////////////////////////////////
// #region aws-cdk

const cli = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: 'aws-cdk',
    description: 'AWS CDK CLI, the command line tool for CDK apps',
    majorVersion: 2,
    srcdir: 'lib',
    devDeps: [
      yargsGen,
      cliPluginContract,
      '@types/archiver',
      '@types/fs-extra@^9',
      '@types/mockery',
      '@types/picomatch',
      '@types/promptly',
      '@types/semver',
      '@types/sinon',
      '@types/yargs@^15',
      'aws-cdk-lib',
      'aws-sdk-client-mock',
      'aws-sdk-client-mock-jest',
      'axios',
      'constructs',
      'fast-check',
      'jest-environment-node',
      'jest-mock',
      'madge',
      'nock@13',
      'sinon',
      'ts-mock-imports',
      'xml-js',
    ],
    deps: [
      cloudAssemblySchema.customizeReference({ versionType: 'any-future' }),
      cloudFormationDiff.customizeReference({ versionType: 'exact' }),
      cxApi,
      cloudAssemblyApi.customizeReference({ versionType: 'exact' }),
      toolkitLib,
      'archiver',
      '@aws-sdk/client-appsync',
      '@aws-sdk/client-bedrock-agentcore-control',
      '@aws-sdk/client-cloudformation',
      '@aws-sdk/client-cloudwatch-logs',
      '@aws-sdk/client-cloudcontrol',
      '@aws-sdk/client-codebuild',
      '@aws-sdk/client-ec2',
      '@aws-sdk/client-ecr',
      '@aws-sdk/client-ecs',
      '@aws-sdk/client-elastic-load-balancing-v2',
      '@aws-sdk/client-iam',
      '@aws-sdk/client-kms',
      '@aws-sdk/client-lambda',
      '@aws-sdk/client-route-53',
      '@aws-sdk/client-s3',
      '@aws-sdk/client-secrets-manager',
      '@aws-sdk/client-sfn',
      '@aws-sdk/client-ssm',
      '@aws-sdk/client-sts',
      '@aws-sdk/credential-providers',
      '@aws-sdk/ec2-metadata-service',
      '@aws-sdk/lib-storage',
      '@smithy/middleware-endpoint',
      '@smithy/property-provider',
      '@smithy/shared-ini-file-loader',
      '@smithy/types',
      '@smithy/util-retry',
      '@smithy/util-waiter',
      'camelcase@^6', // Non-ESM
      cdkAssetsLib,
      'cdk-from-cfn',
      'chalk@^4',
      'chokidar@^4',
      'decamelize@^5', // Non-ESM
      'enquirer',
      'fs-extra@^9',
      'fast-glob',
      'picomatch',
      'p-limit@^3',
      'p-queue@^6',
      'promptly',
      'proxy-agent',
      'semver',
      'strip-ansi@^6',
      'uuid',
      'wrap-ansi@^7', // Last non-ESM version
      'yaml@^1',
      'yargs@^15',
    ],
    excludeDepsFromUpgrade: ['aws-cdk-lib'], // this is handled separately further down
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
        lib: ['es2019', 'es2022.error'],

        // Changes the meaning of 'import' for libraries whose top-level export is a function
        // 'aws-cdk' has been written against `false` for interop
        esModuleInterop: false,

        // Necessary to properly compile proxy-agent and lru-cache without esModuleInterop set.
        skipLibCheck: true,
      },
    },
    tsconfigDev: {
      compilerOptions: {
        ...defaultTsOptions,
        lib: ['es2019', 'esnext.disposable', 'es2022.error'],
        esModuleInterop: false,
        skipLibCheck: true,
      },
    },
    eslintOptions: {
      dirs: ['lib'],
      ignorePatterns: ['*.template.ts', '*.d.ts'],
    },
    jestOptions: jestOptionsForProject({
      jestConfig: {
        coverageThreshold: {
          // We want to improve our test coverage
          // DO NOT LOWER THESE VALUES!
          // If you need to break glass, open an issue to re-up the values with additional test coverage
          statements: 81,
          branches: 76,
          functions: 87,
          lines: 81,
        },
        // We have many tests here that commonly time out
        testTimeout: 60_000,
        coveragePathIgnorePatterns: [
          // legacy files
          '<rootDir>/lib/legacy-*.ts',
          '<rootDir>/lib/init-templates/',

          // Files generated by cli-args-gen
          '<rootDir>/lib/cli/parse-command-line-arguments.ts',
          '<rootDir>/lib/cli/user-input.ts',
          '<rootDir>/lib/cli/convert-to-user-input.ts',
        ],
        testEnvironment: './test/_helpers/jest-bufferedconsole.ts',
        setupFilesAfterEnv: ['<rootDir>/test/_helpers/jest-setup-after-env.ts'],
      },
    }),

    nextVersionCommand: 'tsx ../../projenrc/next-version.ts neverMajor maybeRc',

    releasableCommits: transitiveToolkitPackages('aws-cdk'),
  }),
);

new pj.javascript.UpgradeDependencies(cli, {
  include: ['aws-cdk-lib'],
  semanticCommit: 'feat',
  pullRequestTitle: 'upgrade aws-cdk-lib',
  target: 'minor',
  taskName: 'upgrade-aws-cdk-lib',
  workflow: true,
  workflowOptions: {
    schedule: pj.javascript.UpgradeDependenciesSchedule.WEEKDAY,
    labels: ['auto-approve'],
  },
});

new TypecheckTests(cli);
fixupTestTask(cli);

// Eslint rules
cli.eslint?.addRules({
  '@cdklabs/no-throw-default-error': 'error',
});
cli.eslint?.addOverride({
  files: ['./test/**'],
  rules: {
    '@cdklabs/no-throw-default-error': 'off',
    '@typescript-eslint/unbound-method': 'off',
  },
});

// Do include all .ts files inside init-templates
cli.npmignore?.addPatterns('!lib/init-templates/**/*.ts');

// Exclude other scripts and files from the npm package
cli.npmignore?.addPatterns(
  'images/',
  'CONTRIBUTING.md',
  'generate.sh',
);

cli.gitignore.addPatterns(
  ...ADDITIONAL_CLI_IGNORE_PATTERNS,
  '!lib/init-templates/**',
);

// People should not have imported from the `aws-cdk` package, but they have in the past.
// We have identified all locations that are currently used, are maintaining a backwards compat
// layer for those. Future imports will be rejected.
cli.package.addField('exports', {
  // package.json is always reasonable
  './package.json': './package.json',
  './build-info.json': './build-info.json',
  // The rest is legacy
  '.': './lib/legacy-exports.js',
  './bin/cdk': './bin/cdk',
  './lib/api/bootstrap/bootstrap-template.yaml': './lib/api/bootstrap/bootstrap-template.yaml',
  './lib/util': './lib/legacy-exports.js',
  './lib': './lib/legacy-exports.js',
  './lib/api/plugin': './lib/legacy-exports.js',
  './lib/util/content-hash': './lib/legacy-exports.js',
  './lib/settings': './lib/legacy-exports.js',
  './lib/api/bootstrap': './lib/legacy-exports.js',
  './lib/api/cxapp/cloud-assembly': './lib/legacy-exports.js',
  './lib/api/cxapp/cloud-executable': './lib/legacy-exports.js',
  './lib/api/cxapp/exec': './lib/legacy-exports.js',
  './lib/diff': './lib/legacy-exports.js',
  './lib/api/util/string-manipulation': './lib/legacy-exports.js',
  './lib/util/console-formatters': './lib/legacy-exports.js',
  './lib/util/tracing': './lib/legacy-exports.js',
  './lib/commands/docs': './lib/legacy-exports.js',
  './lib/api/hotswap/common': './lib/legacy-exports.js',
  './lib/util/objects': './lib/legacy-exports.js',
  './lib/api/deployments': './lib/legacy-exports.js',
  './lib/util/directories': './lib/legacy-exports.js',
  './lib/version': './lib/legacy-exports.js',
  './lib/init': './lib/legacy-exports.js',
  './lib/api/aws-auth/cached': './lib/legacy-exports.js',
  './lib/api/deploy-stack': './lib/legacy-exports.js',
  './lib/api/evaluate-cloudformation-template': './lib/legacy-exports.js',
  './lib/api/aws-auth/credential-plugins': './lib/legacy-exports.js',
  './lib/api/aws-auth/awscli-compatible': './lib/legacy-exports.js',
  './lib/notices': './lib/legacy-exports.js',
  './lib/index': './lib/legacy-exports.js',
  './lib/api/aws-auth/index.js': './lib/legacy-exports.js',
  './lib/api/aws-auth': './lib/legacy-exports.js',
  './lib/logging': './lib/legacy-exports.js',
});

cli.gitignore.addPatterns('build-info.json');

const cliPackageJson = `${cli.workspaceDirectory}/package.json`;

cli.preCompileTask.prependExec('./generate.sh');
cli.preCompileTask.prependExec('ts-node -P tsconfig.dev.json --prefer-ts-exts scripts/user-input-gen.ts');

const includeCliResourcesCommands = [
  'cp $(node -p \'require.resolve("cdk-from-cfn/index_bg.wasm")\') ./lib/',
  'cp $(node -p \'require.resolve("@aws-cdk/aws-service-spec/db.json.gz")\') ./',
];

for (const resourceCommand of includeCliResourcesCommands) {
  cli.postCompileTask.exec(resourceCommand);
}

new BundleCli(cli, {
  allowedLicenses: BUNDLED_LICENSES,
  dontAttribute: '^@aws-cdk/|^@cdklabs/|^cdk-assets$',
  test: 'bin/cdk --version',
  entryPoints: [
    'lib/index.js',
  ],
  minifyWhitespace: true,
});

// Exclude takes precedence over include
for (const tsconfig of [cli.tsconfig, cli.tsconfigDev]) {
  tsconfig?.addExclude('lib/init-templates/*/typescript/*/*.template.ts');
  tsconfig?.addExclude('test/integ/cli/sam_cdk_integ_app/**/*');
  tsconfig?.addExclude('vendor/**/*');
}

// #endregion
//////////////////////////////////////////////////////////////////////
// #region cdk

const cdkAliasPackage = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: 'cdk',
    description: 'AWS CDK Toolkit',
    srcdir: 'lib',
    deps: [cli.customizeReference({ versionType: 'exact' })],
    nextVersionCommand: `tsx ../../projenrc/next-version.ts copyVersion:../../${cliPackageJson}`,
    releasableCommits: transitiveToolkitPackages('cdk'),
    majorVersion: 2,
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
      },
    },
  }),
);
void cdkAliasPackage;

// #endregion
//////////////////////////////////////////////////////////////////////
// #region @aws-cdk/integ-runner

const integRunner = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/integ-runner',
    description: 'CDK Integration Testing Tool',
    majorVersion: 2,
    srcdir: 'lib',
    deps: [
      cloudAssemblySchema.customizeReference({ versionType: 'any-future' }),
      cxApi,
      cloudAssemblyApi.customizeReference({ versionType: 'exact' }),
      cli.customizeReference({ versionType: 'exact' }),
      cdkAssetsLib.customizeReference({ versionType: 'exact' }),
      cloudFormationDiff.customizeReference({ versionType: 'exact' }),
      toolkitLib.customizeReference({ versionType: 'exact' }),
      'workerpool@^6',
      'chokidar@^4',
      'chalk@^4',
      'fs-extra@^9',
      'yargs@^16',
      '@aws-cdk/aws-service-spec',
      '@aws-sdk/client-cloudformation',
    ],
    devDeps: [
      'aws-cdk-lib',
      '@types/fs-extra',
      '@types/mock-fs@^4',
      'mock-fs@^5',
      '@types/workerpool@^6',
      '@types/yargs',
      'constructs@^10',
      '@aws-cdk/integ-tests-alpha@2.184.1-alpha.0',
    ],
    allowPrivateDeps: true,
    tsconfig: {
      compilerOptions: {
        ...toolkitLibTsCompilerOptions,
      },
    },
    jestOptions: jestOptionsForProject({
      jestConfig: {
        coverageThreshold: {
          branches: 79,
        },
      },
    }),
    releasableCommits: transitiveToolkitPackages('@aws-cdk/integ-runner'),
  }),
);
integRunner.gitignore?.addPatterns(
  // Ignore this symlink, we recreate it at test time
  'test/test-archive-follow/data/linked',

  // These files are needed for unit tests
  '!test/test-data/cdk-integ.out*/',

  '!**/*.snapshot/**/asset.*/*.js',
  '!**/*.snapshot/**/asset.*/*.d.ts',
  '!**/*.snapshot/**/asset.*/**',

  'lib/recommended-feature-flags.json',
);
integRunner.tsconfig?.addInclude('lib/*.json');
integRunner.tsconfigDev?.addInclude('lib/*.json');
integRunner.tsconfig?.addInclude('lib/init-templates/*/*/add-project.hook.ts');
integRunner.tsconfig?.addExclude('lib/init-templates/*/typescript/**/*.ts');
integRunner.tsconfig?.addExclude('test/language-tests/**/integ.*.ts');

integRunner.preCompileTask.prependExec('./build-tools/generate.sh');

new TypecheckTests(integRunner);
fixupTestTask(integRunner);

new BundleCli(integRunner, {
  externals: {
    dependencies: [
      '@aws-cdk/aws-service-spec',
      'aws-cdk',
    ],
  },
  allowedLicenses: BUNDLED_LICENSES,
  dontAttribute: '^@aws-cdk/|^@cdklabs/|^cdk-assets$',
  test: 'bin/integ-runner --version',
  entryPoints: [
    'lib/index.js',
    'lib/workers/extract/index.js',
  ],
  minifyWhitespace: true,
});

// #endregion
//////////////////////////////////////////////////////////////////////
// #region @aws-cdk-testing/cli-integ

const cliInteg = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk-testing/cli-integ',
    description: 'Integration tests for the AWS CDK CLI',

    // We set the majorVersion of this to 3.x, so that we can release
    // it already without interfering with the current crop of CDK
    // integ tests.
    majorVersion: 3,

    srcdir: '.',
    libdir: '.',
    deps: [
      '@octokit/rest@^20', // newer versions are ESM only
      '@aws-sdk/client-codeartifact',
      '@aws-sdk/client-cloudformation',
      '@aws-sdk/client-ecr',
      '@aws-sdk/client-ecr-public',
      '@aws-sdk/client-ecs',
      '@aws-sdk/client-iam',
      '@aws-sdk/client-lambda',
      '@aws-sdk/client-s3',
      '@aws-sdk/client-sns',
      '@aws-sdk/client-sso',
      '@aws-sdk/client-sts',
      '@aws-sdk/client-secrets-manager',
      '@aws-sdk/credential-providers',
      '@cdklabs/cdk-atmosphere-client',
      '@smithy/util-retry', // smithy packages don't have the same major version as SDK packages
      '@smithy/types', // smithy packages don't have the same major version as SDK packages
      'axios@^1',
      'chalk@^4',
      'fs-extra@^9',
      'fast-glob',
      'make-runnable@^1',
      'mockttp@^3',
      'npm@^11',
      'p-queue@^6',
      'semver@^7',
      'sinon@^9',
      'ts-mock-imports@^1',
      'yaml@1',
      'yargs@^16',
      // Jest is a runtime dependency here!
      'jest@^29',
      'jest-junit@^15',
      'ts-jest@^29',
      'proxy-agent',
      'node-pty',
    ],
    devDeps: [
      yarnCling,
      toolkitLib.customizeReference({ versionType: 'exact' }),
      '@types/semver@^7',
      '@types/yargs@^16',
      '@types/fs-extra@^9',
    ],
    bin: {
      'run-suite': 'bin/run-suite',
      'download-and-run-old-tests': 'bin/download-and-run-old-tests',
      'query-github': 'bin/query-github',
      'apply-patches': 'bin/apply-patches',
      'test-root': 'bin/test-root',
      'stage-distribution': 'bin/stage-distribution',
    },
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
        esModuleInterop: false,
        target: 'es2022',
        lib: ['es2022', 'esnext.disposable', 'dom'],
        module: 'NodeNext',
      },
      include: ['**/*.ts'],
      exclude: ['resources/**/*'],
    },
    jestOptions: jestOptionsForProject({
      jestConfig: {
        coverageThreshold: {
          statements: 25,
          lines: 25,
          functions: 10,
          branches: 25,
        },
      },
    }),

    // Append a specific version string for testing
    nextVersionCommand: 'tsx ../../../projenrc/next-version.ts neverMajor maybeRc',
  }),
);
cliInteg.eslint?.addIgnorePattern('resources/**/*.ts');

cliInteg.deps.addDependency('@aws-cdk/toolkit-lib', pj.DependencyType.OPTIONAL);

const compiledDirs = ['tests', 'test', 'lib'];
for (const compiledDir of compiledDirs) {
  cliInteg.gitignore.addPatterns(`${compiledDir}/**/*.js`);
  cliInteg.gitignore.addPatterns(`${compiledDir}/**/*.d.ts`);
}
cliInteg.gitignore.addPatterns('!resources/**/*.js');
cliInteg.npmignore?.addPatterns('!resources/**/*');

cliInteg.postCompileTask.exec('yarn-cling');
cliInteg.gitignore.addPatterns('npm-shrinkwrap.json');

// #endregion
//////////////////////////////////////////////////////////////////////
// #region shared setup

// The pj.github.Dependabot component is only for a single Node project,
// but we need multiple non-Node projects
new pj.YamlFile(repo, '.github/dependabot.yml', {
  obj: {
    version: 2,
    updates: [
      {
        'package-ecosystem': 'npm',
        'schedule': { interval: 'weekly' },
        'labels': ['auto-approve'],
        'allow': [{
          'dependency-type': 'production',
        }],
        'directories': ['/', ...repoProject.node.children
          .filter(child => child instanceof TypeScriptWorkspace)
          .map(ts => `/${path.relative(repoProject.outdir, ts.outdir)}`)
          .sort()],
      },
      // init-templates
      ...['pip', 'maven', 'nuget'].map((pkgEco) => ({
        'package-ecosystem': pkgEco,
        'directory': '/packages/aws-cdk/lib/init-templates',
        'schedule': { interval: 'weekly' },
        'labels': ['auto-approve'],
        'open-pull-requests-limit': 5,
      })),
    ],
  },
  committed: true,
});

// By default, projen ignores any directories named 'logs', but we have a source directory
// like that in the CLI (https://github.com/projen/projen/issues/4059).
for (const gi of [repo.gitignore, cli.gitignore]) {
  gi.removePatterns('logs');
}
const APPROVAL_ENVIRONMENT = 'integ-approval';
const TEST_ENVIRONMENT = 'run-tests';

new CdkCliIntegTestsWorkflow(repo, {
  sourceRepo: 'aws/aws-cdk-cli',
  approvalEnvironment: APPROVAL_ENVIRONMENT,
  testEnvironment: TEST_ENVIRONMENT,
  buildRunsOn: POWERFUL_RUNNER,
  testRunsOn: POWERFUL_RUNNER,

  allowUpstreamVersions: [
    // cloud-assembly-schema gets referenced under multiple versions
    // - Candidate version for cdk-assets
    // - Previously released version for aws-cdk-lib
    cloudAssemblySchema,

    // toolkit-lib can get referenced under multiple versions,
    // and during the 0.x period most likely *will*.
    // - The Amplify CLI will only depend on versions that are already published.
    //   These can be `0.3.2` or `^1`. We can't hijack the NPM install so this has to
    //   resolve to a proper version.
    // - If they use `^1` then our prerelease version will be automatically installed...
    //   unless we are releasing a breaking change, in which case they will depend
    //   on `^1` but we will be testing `2.0.999`, so the upstream still needs to
    //   be available to make this test succeed.
    toolkitLib,

    // The `tool-integrations` job installs the amplify-cli package,
    // which depends on @aws-cdk/cloudformation-diff as a transitive dependency through toolkit-lib
    // Since we are not enforcing the use of the local version of toolkit-lib in this test,
    // it might attempt to install a version of @aws-cdk/cloudformation-diff that's not locally available.
    cloudFormationDiff,
  ],
  enableAtmosphere: {
    oidcRoleArn: '${{ vars.CDK_ATMOSPHERE_PROD_OIDC_ROLE }}',
    endpoint: '${{ vars.CDK_ATMOSPHERE_PROD_ENDPOINT }}',
    pool: '${{ vars.CDK_INTEG_ATMOSPHERE_POOL }}',
  },
  additionalNodeVersionsToTest: [
    // 18.18 introduces `Symbol.dispose`, and we need to make sure that we work on older versions as well
    '18.17.0',
    '20', '22', '24',
  ],
});

new CodeCovWorkflow(repo, {
  restrictToRepos: ['aws/aws-cdk-cli'],
  packages: [cli.name],
});

new IssueLabeler(repo);
new PrLabeler(repo);

new LargePrChecker(repo, {
  excludeFiles: ['*.md', '*.test.ts', '*.yml', '*.lock', 'THIRD_PARTY_LICENSES'],
});

// Set allowed scopes based on monorepo packages
const disallowed = new Set([
  'cdk', // use aws-cdk or cli
  'user-input-gen', // use cli
]);
repoProject.github?.tryFindWorkflow('pull-request-lint')?.file?.patch(
  pj.JsonPatch.replace('/jobs/validate/steps/0/with/scopes', [
    'cli',
    'deps',
    'dev-deps', // projen
    'deps-dev', // dependabot
    'docs',
    'bootstrap',
    'integ-testing',
    'toolkit-lib',
    ...repoProject.subprojects
      .filter(p => p instanceof yarn.TypeScriptWorkspace)
      .map(p => p.name)
      .map(n => n.split('/').pop()),
  ].filter(s => s && !disallowed.has(s)).sort().join('\n')),
);

repo.synth();

// #endregion
