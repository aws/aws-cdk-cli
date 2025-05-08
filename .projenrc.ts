import * as path from 'path';
import { yarn } from 'cdklabs-projen-project-types';
import { TypeScriptWorkspace, type TypeScriptWorkspaceOptions } from 'cdklabs-projen-project-types/lib/yarn';
import * as pj from 'projen';
import { Stability } from 'projen/lib/cdk';
import { AdcPublishing } from './projenrc/adc-publishing';
import { BundleCli } from './projenrc/bundle';
import { CdkCliIntegTestsWorkflow } from './projenrc/cdk-cli-integ-tests';
import { CodeCovWorkflow } from './projenrc/codecov';
import { ESLINT_RULES } from './projenrc/eslint';
import { IssueLabeler } from './projenrc/issue-labeler';
import { JsiiBuild } from './projenrc/jsii';
import { LargePrChecker } from './projenrc/large-pr-checker';
import { PrLabeler } from './projenrc/pr-labeler';
import { RecordPublishingTimestamp } from './projenrc/record-publishing-timestamp';
import { DocType, S3DocsPublishing } from './projenrc/s3-docs-publishing';
import { TypecheckTests } from './projenrc/TypecheckTests';

// 5.7 sometimes gives a weird error in `ts-jest` in `@aws-cdk/cli-lib-alpha`
// https://github.com/microsoft/TypeScript/issues/60159
const TYPESCRIPT_VERSION = '5.6';

/**
 * Projen depends on TypeScript-eslint 7 by default.
 *
 * We want 8 for the parser, and 6 for the plugin (because after 6 some linter
 * rules we are relying on have been moved to another plugin).
 *
 * Also configure eslint plugins & rules, which cannot be configured by props.
 *
 * We also need to override the built-in prettier dependency to prettier@2, because
 * Jest < 30 can only work with prettier 2 (https://github.com/jestjs/jest/issues/14305)
 * and 30 is not stable yet.
 */
function configureProject<A extends pj.typescript.TypeScriptProject>(x: A): A {
  x.package.addEngine('node', '>= 14.15.0');
  x.addDevDeps(
    '@typescript-eslint/eslint-plugin@^8',
    '@typescript-eslint/parser@^8',
    '@stylistic/eslint-plugin@^3',
    '@cdklabs/eslint-plugin',
    'eslint-plugin-import',
    'eslint-plugin-jest',
    'eslint-plugin-jsdoc',
    'jest-junit@^16',
  );
  x.eslint?.addPlugins(
    '@typescript-eslint',
    'import',
    '@cdklabs',
    '@stylistic',
    'jest',
    'jsdoc',
  );
  x.eslint?.addExtends(
    'plugin:jest/recommended',
  );
  x.eslint?.addIgnorePattern('*.generated.ts');
  x.eslint?.addRules(ESLINT_RULES);

  // Prettier needs to be turned off for now, there's too much code that doesn't conform to it
  x.eslint?.addRules({ 'prettier/prettier': ['off'] });

  x.addDevDeps('prettier@^2.8');

  x.npmignore?.addPatterns('.eslintrc.js');
  // As a rule we don't include .ts sources in the NPM package
  x.npmignore?.addPatterns('*.ts', '!*.d.ts');

  // Never include the build-tools directory
  x.npmignore?.addPatterns('build-tools');

  if (x instanceof TypeScriptWorkspace) {
    // Individual workspace packages shouldn't depend on "projen", it gets brought in at the monorepo root
    x.deps.removeDependency('projen');
  }

  return x;
}

const POWERFUL_RUNNER = 'aws-cdk_ubuntu-latest_16-core';

const workflowRunsOn = [
  POWERFUL_RUNNER,
];

// Ignore patterns that apply both to the CLI and to cli-lib
const ADDITIONAL_CLI_IGNORE_PATTERNS = [
  'db.json.gz',
  '.init-version.json',
  'index_bg.wasm',
  'build-info.json',
  '.recommended-feature-flags.json',
  'synth.lock',
];

const CLI_SDK_V3_RANGE = '^3';

const defaultTsOptions: NonNullable<TypeScriptWorkspaceOptions['tsconfig']>['compilerOptions'] = {
  target: 'ES2020',
  module: 'commonjs',
  lib: ['es2020'],
  incremental: true,
  esModuleInterop: false,
  skipLibCheck: true,
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
    '@aws-cdk/cloudformation-diff',
    '@aws-cdk/toolkit-lib',
  ];

  return transitiveFeaturesAndFixes(thisPkg, toolkitPackages.filter(name => name !== thisPkg));
}

const repoProject = new yarn.Monorepo({
  projenrcTs: true,
  name: 'aws-cdk-cli',
  description: "Monorepo for the AWS CDK's CLI",
  repository: 'https://github.com/aws/aws-cdk-cli',

  defaultReleaseBranch: 'main',
  typescriptVersion: TYPESCRIPT_VERSION,
  devDeps: [
    'cdklabs-projen-project-types',
    'glob',
    'semver',
    `@aws-sdk/client-s3@${CLI_SDK_V3_RANGE}`,
    `@aws-sdk/credential-providers@${CLI_SDK_V3_RANGE}`,
    `@aws-sdk/lib-storage@${CLI_SDK_V3_RANGE}`,
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
  workflowRunsOn,
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
      },
    },
  },

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
    tsJestOptions: {
      transformOptions: {
        isolatedModules: true,
      },
    },
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
    typescriptVersion: TYPESCRIPT_VERSION,
    checkLicenses: props.private ? undefined : {
      allow: ['Apache-2.0', 'MIT', 'ISC', 'BSD-3-Clause'],
    },
    ...props,
  } satisfies Partial<yarn.TypeScriptWorkspaceOptions>;
}

//////////////////////////////////////////////////////////////////////

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

new JsiiBuild(cloudAssemblySchema, {
  docgen: false,
  jsiiVersion: TYPESCRIPT_VERSION,
  excludeTypescript: ['**/test/**/*.ts'],
  publishToMaven: {
    javaPackage: 'software.amazon.awscdk.cloudassembly.schema',
    mavenArtifactId: 'cdk-cloud-assembly-schema',
    mavenGroupId: 'software.amazon.awscdk',
    mavenEndpoint: 'https://aws.oss.sonatype.org',
  },
  publishToNuget: {
    dotNetNamespace: 'Amazon.CDK.CloudAssembly.Schema',
    packageId: 'Amazon.CDK.CloudAssembly.Schema',
    iconUrl: 'https://raw.githubusercontent.com/aws/aws-cdk/main/logo/default-256-dark.png',
  },
  publishToPypi: {
    distName: 'aws-cdk.cloud-assembly-schema',
    module: 'aws_cdk.cloud_assembly_schema',
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

//////////////////////////////////////////////////////////////////////

const cloudFormationDiff = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/cloudformation-diff',
    description: 'Utilities to diff CDK stacks against CloudFormation templates',
    srcdir: 'lib',
    deps: [
      '@aws-cdk/aws-service-spec',
      '@aws-cdk/service-spec-types',
      '@aws-sdk/client-cloudformation',
      'chalk@^4',
      'diff',
      'fast-deep-equal',
      'string-width@^4',
      'table@^6',
    ],
    devDeps: ['fast-check'],
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

//////////////////////////////////////////////////////////////////////

// cx-api currently is generated from `aws-cdk-lib` at build time. Not breaking
// this dependency right now.

const cxApi = '@aws-cdk/cx-api';

/*
const cxApi = overrideEslint(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/cx-api',
    description: 'Helper functions to work with CDK Cloud Assembly files',
    srcdir: 'lib',
    deps: ['semver'],
    devDeps: [cloudAssemblySchema, '@types/mock-fs', '@types/semver', 'madge', 'mock-fs'],
    bundledDeps: ['semver'],
    peerDeps: ['@aws-cdk/cloud-assembly-schema@>=38.0.0'],
    // FIXME: this should be a jsii project
    // (EDIT: or should it? We're going to bundle it into aws-cdk-lib)

    /*
    "build": "yarn gen && cdk-build --skip-lint",
    "gen": "cdk-copy cx-api",
    "watch": "cdk-watch",
    "lint": "cdk-lint && madge --circular --extensions js lib",
    */

/*
  "awscdkio": {
    "announce": false
  },
  }),
);
*/

//////////////////////////////////////////////////////////////////////

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
  }),
);
yarnCling.testTask.prependExec('ln -sf ../../cdk test/test-fixture/jsii/node_modules/');

//////////////////////////////////////////////////////////////////////

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

//////////////////////////////////////////////////////////////////////

const nodeBundle = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps({
      private: true,
    }),
    parent: repo,
    name: '@aws-cdk/node-bundle',
    description: 'Tool for generating npm-shrinkwrap from yarn.lock',
    deps: ['esbuild', 'fs-extra@^9', 'license-checker', 'madge', 'shlex', 'yargs'],
    devDeps: ['@types/license-checker', '@types/madge', '@types/fs-extra@^9', 'jest-junit', 'standard-version'],
    jestOptions: jestOptionsForProject({
      jestConfig: {
        coverageThreshold: {
          branches: 75,
        },
      },
    }),
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
      },
    },
  }),
);
// Too many console statements
nodeBundle.eslint?.addRules({ 'no-console': ['off'] });

//////////////////////////////////////////////////////////////////////

// This should be deprecated, but only after the move
const cliPluginContract = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/cli-plugin-contract',
    description: 'Contract between the CLI and authentication plugins, for the exchange of AWS credentials',
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

//////////////////////////////////////////////////////////////////////

const cdkAssets = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: 'cdk-assets',
    description: 'CDK Asset Publishing Tool',
    srcdir: 'lib',
    deps: [
      cloudAssemblySchema.customizeReference({ versionType: 'minimal' }),
      cxApi,
      'archiver',
      'glob',
      'mime@^2',
      'yargs',
      `@aws-sdk/client-ecr@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-s3@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-secrets-manager@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-sts@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/credential-providers@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/lib-storage@${CLI_SDK_V3_RANGE}`,
      '@smithy/config-resolver',
      '@smithy/node-config-provider',
    ],
    devDeps: [
      '@types/archiver',
      '@types/yargs',
      '@types/mime@^2',
      'fs-extra',
      'graceful-fs',
      'jszip',
      '@types/mock-fs@^4',
      'mock-fs@^5',
      '@smithy/types',
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
    releaseWorkflowSetupSteps: [
      {
        name: 'Shrinkwrap',
        run: 'npx projen shrinkwrap',
      },
    ],
    majorVersion: 3,

    jestOptions: jestOptionsForProject({
      jestConfig: {
        // We have many tests here that commonly time out
        testTimeout: 10_000,
      },
    }),

    // Append a specific version string for testing
    nextVersionCommand: 'tsx ../../projenrc/next-version.ts neverMajor maybeRc',
  }),
);

new TypecheckTests(cdkAssets);

cdkAssets.addTask('shrinkwrap', {
  steps: [
    {
      spawn: 'bump',
    },
    {
      exec: 'npm shrinkwrap',
    },
    {
      spawn: 'unbump',
    },
    {
      exec: 'git checkout HEAD -- yarn.lock',
    },
  ],
});

cdkAssets.gitignore.addPatterns(
  '*.js',
  '*.d.ts',
);

// This package happens do something only slightly naughty
cdkAssets.eslint?.addRules({ 'jest/no-export': ['off'] });

//////////////////////////////////////////////////////////////////////

const TOOLKIT_LIB_EXCLUDE_PATTERNS = [
  'lib/init-templates/*/typescript/*/*.template.ts',
];

const toolkitLib = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/toolkit-lib',
    description: 'AWS CDK Programmatic Toolkit Library',
    srcdir: 'lib',
    tsconfigDev: {
      compilerOptions: {
        rootDir: '.', // shouldn't be required but something broke... check again once we have gotten rid of the tmpToolkitHelpers package
      },
    },
    deps: [
      cliPluginContract,
      cloudAssemblySchema,
      // Purposely a ^ dependency so that clients selecting old toolkit library
      // versions still might get upgrades to this dependency.
      cloudFormationDiff,
      cxApi,
      '@aws-cdk/region-info',
      `@aws-sdk/client-appsync@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-cloudformation@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-cloudwatch-logs@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-cloudcontrol@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-codebuild@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-ec2@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-ecr@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-ecs@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-elastic-load-balancing-v2@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-iam@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-kms@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-lambda@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-route-53@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-s3@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-secrets-manager@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-sfn@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-ssm@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-sts@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/credential-providers@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/ec2-metadata-service@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/lib-storage@${CLI_SDK_V3_RANGE}`,
      '@smithy/middleware-endpoint',
      '@smithy/node-http-handler',
      '@smithy/property-provider',
      '@smithy/shared-ini-file-loader',
      '@smithy/util-retry',
      '@smithy/util-waiter',
      'archiver',
      // Purposely a ^ dependency so that clients get upgrades to this library.
      cdkAssets,
      'cdk-from-cfn',
      'chalk@^4',
      'chokidar@^3',
      'fs-extra@^9',
      'glob',
      'minimatch',
      'p-limit@^3',
      'promptly',
      'proxy-agent',
      'semver',
      'split2',
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
      '@smithy/types',
      '@smithy/util-stream',
      '@types/fs-extra',
      '@types/split2',
      'aws-cdk-lib',
      'aws-sdk-client-mock',
      'aws-sdk-client-mock-jest',
      'fast-check',
      'jest-environment-node',
      'nock@13',
      'typedoc',
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
        coverageThreshold: {
          // this is very sad but we will get better
          statements: 87,
          branches: 83,
          functions: 82,
          lines: 87,
        },
        testEnvironment: './test/_helpers/jest-bufferedconsole.ts',
        setupFilesAfterEnv: ['<rootDir>/test/_helpers/jest-setup-after-env.ts'],
      },
    }),
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
        target: 'es2022',
        lib: ['es2022', 'esnext.disposable', 'dom'],
        module: 'NodeNext',
      },
    },
    nextVersionCommand: 'tsx ../../../projenrc/next-version.ts maybeRc',
  }),
);

new TypecheckTests(toolkitLib);

// TypeDoc documentation publishing
new S3DocsPublishing(toolkitLib, {
  docsStream: 'toolkit-lib',
  artifactPath: 'docs.zip',
  bucketName: '${{ vars.DOCS_BUCKET_NAME }}',
  roleToAssume: '${{ vars.PUBLISH_TOOLKIT_LIB_DOCS_ROLE_ARN }}',
  docType: DocType.TYPEDOC,
});

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
          logLevel: 'warning',
        },
      },
      extractorMessageReporting: {
        'default': {
          logLevel: 'warning',
        },
        'ae-missing-release-tag': {
          logLevel: 'none',
        },
      },
      tsdocMessageReporting: {
        default: {
          logLevel: 'warning',
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
    ],
    supportForTags: {
      '@default': true,
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
  'typedoc.json',
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

// Add a command for the Typedoc docs
const toolkitLibDocs = toolkitLib.addTask('docs', {
  exec: 'typedoc lib/index.ts',
  receiveArgs: true,
});

// Add commands for the API Extractor docs
const apiExtractorDocsTask = toolkitLib.addTask('api-extractor-docs', {
  exec: [
    // Run api-extractor to generate the API model
    'api-extractor run || true',
    // Create a directory for the API model
    'mkdir -p dist/api-extractor-docs/cdk/api/toolkit-lib',
    // Copy the API model to the directory (with error handling)
    'if [ -f dist/toolkit-lib.api.json ]; then cp dist/toolkit-lib.api.json dist/api-extractor-docs/cdk/api/toolkit-lib/; else echo "Warning: API JSON file not found"; fi',
    // Add version file
    '(cat dist/version.txt || echo "latest") > dist/api-extractor-docs/cdk/api/toolkit-lib/VERSION',
    // Copy README.md if it exists
    'if [ -f README.md ]; then cp README.md dist/api-extractor-docs/cdk/api/toolkit-lib/; fi',
    // Copy all files from docs directory if it exists
    'if [ -d docs ]; then mkdir -p dist/api-extractor-docs/cdk/api/toolkit-lib/docs && cp -r docs/* dist/api-extractor-docs/cdk/api/toolkit-lib/docs/; fi',
    // Zip the API model and docs files
    'cd dist/api-extractor-docs && zip -r -q ../api-extractor-docs.zip cdk',
  ].join(' && '),
});

// Add the API Extractor docs task to the package task
toolkitLib.packageTask.spawn(apiExtractorDocsTask);

// When packaging, output the docs into a specific nested directory
// This is required because the zip file needs to have this structure when created
toolkitLib.packageTask.spawn(toolkitLibDocs, { args: ['--out dist/docs/cdk/api/toolkit-lib'] });
// The docs build needs the version in a specific file at the nested root
toolkitLib.packageTask.exec('(cat dist/version.txt || echo "latest") > dist/docs/cdk/api/toolkit-lib/VERSION');
// Zip the whole thing up, again paths are important here to get the desired folder structure
toolkitLib.packageTask.exec('zip -r -q ../docs.zip cdk', { cwd: 'dist/docs' });

toolkitLib.addTask('publish-local', {
  exec: './build-tools/package.sh',
  receiveArgs: true,
});

//////////////////////////////////////////////////////////////////////

const cli = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: 'aws-cdk',
    description: 'AWS CDK CLI, the command line tool for CDK apps',
    srcdir: 'lib',
    devDeps: [
      nodeBundle,
      yargsGen,
      cliPluginContract,
      toolkitLib,
      '@octokit/rest',
      '@types/archiver',
      '@types/fs-extra@^9',
      '@types/mockery',
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
      cloudAssemblySchema.customizeReference({ versionType: 'minimal' }),
      cloudFormationDiff.customizeReference({ versionType: 'exact' }),
      cxApi,
      'archiver',
      `@aws-sdk/client-appsync@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-cloudformation@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-cloudwatch-logs@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-cloudcontrol@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-codebuild@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-ec2@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-ecr@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-ecs@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-elastic-load-balancing-v2@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-iam@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-kms@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-lambda@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-route-53@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-s3@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-secrets-manager@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-sfn@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-ssm@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-sts@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/credential-providers@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/ec2-metadata-service@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/lib-storage@${CLI_SDK_V3_RANGE}`,
      '@aws-sdk/middleware-endpoint',
      '@aws-sdk/util-retry',
      '@aws-sdk/util-waiter',
      '@smithy/middleware-endpoint',
      '@smithy/shared-ini-file-loader',
      '@smithy/property-provider',
      '@smithy/types',
      '@smithy/util-retry',
      '@smithy/util-waiter',
      'camelcase@^6', // Non-ESM
      cdkAssets,
      // A version that is guaranteed to still work on Node 16
      'cdk-from-cfn@0.162.1',
      'chalk@^4',
      'chokidar@^3',
      'decamelize@^5', // Non-ESM
      'fs-extra@^9',
      'glob',
      'minimatch',
      'p-limit@^3',
      'promptly',
      'proxy-agent',
      'semver',
      'strip-ansi@^6',
      'uuid',
      'wrap-ansi@^7', // Last non-ESM version
      'yaml@^1',
      'yargs@^15',
    ],
    tsJestOptions: {
      transformOptions: {
        // Skips type checking, otherwise tests take too long
        isolatedModules: true,
      },
    },
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
    majorVersion: 2,
  }),
);

new TypecheckTests(cli);

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
  externals: {
    optionalDependencies: [
      'fsevents',
    ],
  },
  allowedLicenses: [
    'Apache-2.0',
    'MIT',
    'BSD-3-Clause',
    'ISC',
    'BSD-2-Clause',
    '0BSD',
    'MIT OR Apache-2.0',
  ],
  dontAttribute: '^@aws-cdk/|^@cdklabs/|^cdk-assets$|^cdk-cli-wrapper$',
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

//////////////////////////////////////////////////////////////////////

const CLI_LIB_EXCLUDE_PATTERNS = [
  'lib/init-templates/*/typescript/*/*.template.ts',
];

const cliLib = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/cli-lib-alpha',
    entrypoint: 'lib/main.js', // Bundled entrypoint
    description: 'AWS CDK Programmatic CLI library',
    srcdir: 'lib',
    devDeps: ['aws-cdk-lib', cli.customizeReference({ versionType: 'exact' }), 'constructs'],
    disableTsconfig: true,
    nextVersionCommand: `tsx ../../../projenrc/next-version.ts copyVersion:../../../${cliPackageJson} append:-alpha.0`,
    releasableCommits: transitiveToolkitPackages('@aws-cdk/cli-lib-alpha'),
    majorVersion: 2,
    eslintOptions: {
      dirs: ['lib'],
      ignorePatterns: [
        ...CLI_LIB_EXCLUDE_PATTERNS,
        '*.d.ts',
      ],
    },
    jestOptions: jestOptionsForProject({
      jestConfig: {
        // cli-lib-alpha cannot deal with the ts files for some reason
        // we can revisit this once toolkit-lib work has progressed
        moduleFileExtensions: undefined,
      },
    }),
    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
      },
    },
  }),
);

// Do include all .ts files inside init-templates
cliLib.npmignore?.addPatterns(
  '!lib/init-templates/**/*.ts',
  '!lib/api/bootstrap/bootstrap-template.yaml',
);

cliLib.gitignore.addPatterns(
  ...ADDITIONAL_CLI_IGNORE_PATTERNS,
  'lib/**/*.yaml',
  'lib/**/*.yml',
  'lib/init-templates/**',
  'cdk.out',
);

new JsiiBuild(cliLib, {
  jsiiVersion: TYPESCRIPT_VERSION,
  publishToNuget: {
    dotNetNamespace: 'Amazon.CDK.Cli.Lib.Alpha',
    packageId: 'Amazon.CDK.Cli.Lib.Alpha',
    iconUrl: 'https://raw.githubusercontent.com/aws/aws-cdk/main/logo/default-256-dark.png',
  },
  publishToMaven: {
    javaPackage: 'software.amazon.awscdk.cli.lib.alpha',
    mavenGroupId: 'software.amazon.awscdk',
    mavenArtifactId: 'cdk-cli-lib-alpha',
    mavenEndpoint: 'https://aws.oss.sonatype.org',
  },
  publishToPypi: {
    distName: 'aws-cdk.cli-lib-alpha',
    module: 'aws_cdk.cli_lib_alpha',
  },
  pypiClassifiers: [
    'Framework :: AWS CDK',
    'Framework :: AWS CDK :: 2',
  ],
  publishToGo: {
    moduleName: 'github.com/aws/aws-cdk-go',
    packageName: 'awscdkclilibalpha',
  },
  rosettaStrict: true,
  stability: Stability.EXPERIMENTAL,
  composite: true,
  excludeTypescript: CLI_LIB_EXCLUDE_PATTERNS,
});

// clilib needs to bundle some resources, same as the CLI
cliLib.postCompileTask.exec('node-bundle validate --external=fsevents:optional --entrypoint=lib/index.js --fix --dont-attribute "^@aws-cdk/|^cdk-assets$|^cdk-cli-wrapper$|^aws-cdk$"');
cliLib.postCompileTask.exec('mkdir -p ./lib/api/bootstrap/ && cp ../../aws-cdk/lib/api/bootstrap/bootstrap-template.yaml ./lib/api/bootstrap/');
for (const resourceCommand of includeCliResourcesCommands) {
  cliLib.postCompileTask.exec(resourceCommand);
}
cliLib.postCompileTask.exec('cp $(node -p \'require.resolve("aws-cdk/build-info.json")\') .');
cliLib.postCompileTask.exec('esbuild --bundle lib/index.ts --target=node18 --platform=node --external:fsevents --minify-whitespace --outfile=lib/main.js');
cliLib.postCompileTask.exec('node ./lib/main.js >/dev/null </dev/null'); // Smoke test

// Exclude takes precedence over include
for (const tsconfig of [cliLib.tsconfigDev]) {
  for (const pat of CLI_LIB_EXCLUDE_PATTERNS) {
    tsconfig?.addExclude(pat);
  }
}

//////////////////////////////////////////////////////////////////////

const cdkCliWrapper = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps({
      private: true,
    }),
    parent: repo,
    name: '@aws-cdk/cdk-cli-wrapper',
    description: 'CDK CLI Wrapper Library',
    srcdir: 'lib',
    devDeps: [],
    nextVersionCommand: `tsx ../../../projenrc/next-version.ts copyVersion:../../../${cliPackageJson}`,
    releasableCommits: transitiveToolkitPackages('@aws-cdk/cdk-cli-wrapper'),

    jestOptions: jestOptionsForProject({
      jestConfig: {
        coverageThreshold: {
          branches: 62,
        },
      },
    }),

    tsconfig: {
      compilerOptions: {
        ...defaultTsOptions,
      },
    },
  }),
);

/* Can't have this -- the integ-runner depends on this package
(() => {
  const integ = cdkCliWrapper.addTask('integ', {
    exec: 'integ-runner --language javascript',
  });
  cdkCliWrapper.testTask.spawn(integ);
})();
*/

//////////////////////////////////////////////////////////////////////

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

//////////////////////////////////////////////////////////////////////

const integRunner = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/integ-runner',
    description: 'CDK Integration Testing Tool',
    srcdir: 'lib',
    deps: [
      cloudAssemblySchema.customizeReference({ versionType: 'minimal' }),
      cxApi,
      cdkCliWrapper.customizeReference({ versionType: 'exact' }),
      cli.customizeReference({ versionType: 'exact' }),
      cdkAssets.customizeReference({ versionType: 'exact' }),
      cloudFormationDiff.customizeReference({ versionType: 'exact' }),
      'workerpool@^6',
      'chokidar@^3',
      'chalk@^4',
      'fs-extra@^9',
      'yargs@^16',
      '@aws-cdk/aws-service-spec',
      '@aws-sdk/client-cloudformation@^3',
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
        ...defaultTsOptions,
        lib: ['es2020', 'dom'],
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
integRunner.tsconfig?.addInclude('lib/init-templates/*/*/add-project.hook.ts');
integRunner.tsconfig?.addExclude('lib/init-templates/*/typescript/**/*.ts');
integRunner.tsconfig?.addExclude('test/language-tests/**/integ.*.ts');

integRunner.preCompileTask.prependExec('./build-tools/generate.sh');

new BundleCli(integRunner, {
  externals: {
    optionalDependencies: [
      'fsevents',
    ],
    dependencies: [
      '@aws-cdk/aws-service-spec',
      'aws-cdk',
    ],
  },
  allowedLicenses: [
    'Apache-2.0',
    'MIT',
    'BSD-3-Clause',
    'ISC',
    'BSD-2-Clause',
    '0BSD',
    'MIT OR Apache-2.0',
  ],
  dontAttribute: '^@aws-cdk/|^@cdklabs/|^cdk-assets$|^cdk-cli-wrapper$',
  test: 'bin/integ-runner --version',
  entryPoints: [
    'lib/index.js',
    'lib/workers/extract/index.js',
  ],
  minifyWhitespace: true,
});

//////////////////////////////////////////////////////////////////////

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
      '@octokit/rest@^18.12.0',
      `@aws-sdk/client-codeartifact@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-cloudformation@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-ecr@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-ecr-public@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-ecs@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-iam@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-lambda@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-s3@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-sns@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-sso@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-sts@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/credential-providers@${CLI_SDK_V3_RANGE}`,
      `@smithy/util-retry@${CLI_SDK_V3_RANGE}`,
      `@smithy/types@${CLI_SDK_V3_RANGE}`,
      '@cdklabs/cdk-atmosphere-client',
      'axios@^1',
      'chalk@^4',
      'fs-extra@^9',
      'glob@^7',
      'make-runnable@^1',
      'mockttp@^3',
      'npm@^10',
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
      'node-pty',
    ],
    devDeps: [
      yarnCling,
      toolkitLib.customizeReference({ versionType: 'exact' }),
      '@types/semver@^7',
      '@types/yargs@^16',
      '@types/fs-extra@^9',
      '@types/glob@^7',
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
    nextVersionCommand: 'tsx ../../../projenrc/next-version.ts maybeRc',
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

//////////////////////////////////////////////////////////////////////

// The pj.github.Dependabot component is only for a single Node project,
// but we need multiple non-Node projects
new pj.YamlFile(repo, '.github/dependabot.yml', {
  obj: {
    version: 2,
    updates: ['pip', 'maven', 'nuget'].map((pkgEco) => ({
      'package-ecosystem': pkgEco,
      'directory': '/packages/aws-cdk/lib/init-templates',
      'schedule': { interval: 'weekly' },
      'labels': ['auto-approve'],
      'open-pull-requests-limit': 5,
    })),
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

  localPackages: [
    cloudAssemblySchema.name,
    cloudFormationDiff.name,
    cdkAssets.name,
    cli.name,
    cliLib.name,
    cdkAliasPackage.name,
    cliInteg.name,
    toolkitLib.name,
  ],

  allowUpstreamVersions: [
    // cloud-assembly-schema gets referenced under multiple versions
    // - Candidate version for cdk-assets
    // - Previously released version for aws-cdk-lib
    cloudAssemblySchema.name,
  ],
  enableAtmosphere: {
    oidcRoleArn: '${{ vars.CDK_ATMOSPHERE_PROD_OIDC_ROLE }}',
    endpoint: '${{ vars.CDK_ATMOSPHERE_PROD_ENDPOINT }}',
    pool: '${{ vars.CDK_INTEG_ATMOSPHERE_POOL }}',
  },
});

new CodeCovWorkflow(repo, {
  restrictToRepos: ['aws/aws-cdk-cli'],
  packages: [cli.name],
});

new IssueLabeler(repo);
new PrLabeler(repo);

new LargePrChecker(repo, {
  excludeFiles: ['*.md', '*.test.ts', '*.yml', '*.lock'],
});

repo.synth();
