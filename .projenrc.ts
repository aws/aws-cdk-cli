import { yarn, CdkCliIntegTestsWorkflow } from 'cdklabs-projen-project-types';
import * as pj from 'projen';
import { Stability } from 'projen/lib/cdk';
import { BundleCli } from './projenrc/bundle';
import { ESLINT_RULES } from './projenrc/eslint';
import { JsiiBuild } from './projenrc/jsii';
import { CodeCovWorkflow } from './projenrc/codecov';
import { AdcPublishing } from './projenrc/adc-publishing';
import { RecordPublishingTimestamp } from './projenrc/record-publishing-timestamp';

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
  x.addDevDeps(
    '@typescript-eslint/eslint-plugin@^8',
    '@typescript-eslint/parser@^8',
    '@stylistic/eslint-plugin',
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

  return x;
}

const POWERFUL_RUNNER = 'aws-cdk_ubuntu-latest_4-core';

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
  '!lib/init-templates/**',
];

// Specifically this and not ^ because when the SDK version updates there is a
// high chance that our manually copied enums are no longer compatible.
//
// FIXME: Sort that out after we've moved.
const CLI_SDK_V3_RANGE = '3.741';

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

const repoProject = new yarn.Monorepo({
  projenrcTs: true,
  name: 'aws-cdk-cli',
  description: "Monorepo for the AWS CDK's CLI",
  repository: 'https://github.com/aws/aws-cdk-cli',

  defaultReleaseBranch: 'main',
  devDeps: [
    'cdklabs-projen-project-types@^0.1.220',
    'glob',
    'semver',
    `@aws-sdk/client-s3@${CLI_SDK_V3_RANGE}`,
    '@aws-sdk/credential-providers',
    '@aws-sdk/lib-storage',
  ],
  vscodeWorkspace: true,
  vscodeWorkspaceOptions: {
    includeRootWorkspace: true,
  },
  nx: true,

  eslintOptions: {
    dirs: ['lib'],
    devdirs: ['test'],
  },

  workflowNodeVersion: 'lts/*',
  workflowRunsOn,
  gitignore: ['.DS_Store'],

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
  dependabot: false,

  githubOptions: {
    mergify: false,
    mergeQueue: true,
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
      allow: ['Apache-2.0', 'MIT', 'ISC'],
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

  cloudAssemblySchema.addPackageIgnore('*.ts');
  cloudAssemblySchema.addPackageIgnore('!*.d.ts');
  cloudAssemblySchema.addPackageIgnore('** /scripts');
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
      'chalk@^4',
      'diff',
      'fast-deep-equal',
      'string-width@^4',
      'table@^6',
    ],
    devDeps: ['@aws-sdk/client-cloudformation', 'fast-check'],
    // FIXME: this should be a jsii project
    // (EDIT: or should it? We're going to bundle it into aws-cdk-lib)
    tsconfig: {
      compilerOptions: {
        esModuleInterop: false,
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
    devDeps: ['@types/semver', '@types/yarnpkg__lockfile'],
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
  }),
);
// Too many console statements
nodeBundle.eslint?.addRules({ 'no-console': ['off'] });

//////////////////////////////////////////////////////////////////////

// This should be deprecated, but only after the move
const cdkBuildTools = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps({
      private: true,
    }),
    parent: repo,
    name: '@aws-cdk/cdk-build-tools',
    description: 'Build tools for CDK packages',
    srcdir: 'lib',
    deps: [
      yarnCling,
      nodeBundle,
      'fs-extra@^9',
      'chalk@^4',
    ],
    devDeps: [
      '@types/fs-extra@^9',
    ],
    tsconfig: {
      compilerOptions: {
        esModuleInterop: false,
      },
    },
  }),
);

//////////////////////////////////////////////////////////////////////

// This should be deprecated, but only after the move
const cliPluginContract = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps({
      private: true,
    }),
    parent: repo,
    name: '@aws-cdk/cli-plugin-contract',
    description: 'Contract between the CLI and authentication plugins, for the exchange of AWS credentials',
    srcdir: 'lib',
    deps: [
    ],
    devDeps: [
    ],
  }),
);

//////////////////////////////////////////////////////////////////////

let CDK_ASSETS: '2' | '3' = ('3' as any);

const cdkAssets = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: 'cdk-assets',
    description: 'CDK Asset Publishing Tool',
    srcdir: 'lib',
    deps: [
      cloudAssemblySchema,
      cxApi,
      'archiver',
      'glob',
      'mime@^2',
      'yargs',
      ...CDK_ASSETS === '2' ? [
        'aws-sdk',
      ] : [
        `@aws-sdk/client-ecr@${CLI_SDK_V3_RANGE}`,
        `@aws-sdk/client-s3@${CLI_SDK_V3_RANGE}`,
        `@aws-sdk/client-secrets-manager@${CLI_SDK_V3_RANGE}`,
        `@aws-sdk/client-sts@${CLI_SDK_V3_RANGE}`,
        '@aws-sdk/credential-providers',
        '@aws-sdk/lib-storage',
        '@smithy/config-resolver',
        '@smithy/node-config-provider',
      ],
    ],
    devDeps: [
      '@types/archiver',
      '@types/glob',
      '@types/yargs',
      '@types/mime@^2',
      'fs-extra',
      'graceful-fs',
      'jszip',
      '@types/mock-fs@^4',
      'mock-fs@^5',
      ...CDK_ASSETS === '2' ? [
      ] : [
        '@smithy/types',
        '@smithy/util-stream',
        'aws-sdk-client-mock',
        'aws-sdk-client-mock-jest',
      ],
    ],
    tsconfigDev: {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        lib: ['es2020', 'dom'],
        incremental: true,
        esModuleInterop: false,
      },
      include: ['bin/**/*.ts'],
    },
    tsconfig: {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        lib: ['es2020', 'dom'],
        incremental: true,
        esModuleInterop: false,
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
    npmDistTag: 'v3-latest',
    prerelease: 'rc',
    majorVersion: 3,

    jestOptions: jestOptionsForProject({
      jestConfig: {
        // We have many tests here that commonly time out
        testTimeout: 10_000,
      },
    }),

    // Append a specific version string for testing
    nextVersionCommand: 'tsx ../../projenrc/next-version.ts maybeRc',
  }),
);

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

let CLI_SDK_VERSION: '2' | '3' = ('3' as any);

const cli = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: 'aws-cdk',
    description: 'AWS CDK CLI, the command line tool for CDK apps',
    srcdir: 'lib',
    devDeps: [
      yarnCling,
      nodeBundle,
      cdkBuildTools,
      yargsGen,
      cliPluginContract,
      '@octokit/rest',
      '@types/archiver',
      '@types/fs-extra@^9',
      '@types/glob',
      '@types/mockery',
      '@types/promptly',
      '@types/semver',
      '@types/sinon',
      '@types/source-map-support',
      '@types/uuid',
      '@types/yargs@^15',
      'aws-cdk-lib',
      ...CLI_SDK_VERSION === '2' ? [
        'aws-sdk-mock@^5',
      ] : [
      ],
      'axios',
      'constructs',
      'fast-check',
      'jest-environment-node',
      'jest-mock',
      'madge',
      'make-runnable',
      'nock',
      'sinon',
      'ts-mock-imports',
      'xml-js',
    ],
    deps: [
      cloudAssemblySchema,
      cloudFormationDiff,
      cxApi,
      '@aws-cdk/region-info',
      '@jsii/check-node',
      'archiver',
      ...CLI_SDK_VERSION === '2' ? [
        'aws-sdk',
      ] : [
        `@aws-sdk/client-appsync@${CLI_SDK_V3_RANGE}`,
        `@aws-sdk/client-cloudformation@${CLI_SDK_V3_RANGE}`,
        `@aws-sdk/client-cloudwatch-logs@${CLI_SDK_V3_RANGE}`,
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
        '@smithy/util-stream',
        '@smithy/util-waiter',
      ],
      'camelcase@^6', // Non-ESM
      cdkAssets,
      // A version that is guaranteed to still work on Node 16
      'cdk-from-cfn@0.162.1',
      'chalk@^4',
      'chokidar@^3',
      'decamelize@^5', // Non-ESM
      'fs-extra@^9',
      'glob',
      'json-diff',
      'minimatch',
      'p-limit@^3',
      'promptly',
      'proxy-agent',
      'semver',
      'source-map-support',
      'strip-ansi@^6',
      'table',
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
        // Changes the meaning of 'import' for libraries whose top-level export is a function
        // 'aws-cdk' has been written against `false` for interop
        esModuleInterop: false,

        // Necessary to properly compile proxy-agent and lru-cache without esModuleInterop set.
        skipLibCheck: true,
      },
    },
    eslintOptions: {
      dirs: ['lib'],
      ignorePatterns: ['*.template.ts', '*.d.ts', 'test/**/*.ts'],
    },
    jestOptions: jestOptionsForProject({
      jestConfig: {
        coverageThreshold: {
          // We want to improve our test coverage
          // DO NOT LOWER THESE VALUES!
          // If you need to break glass, open an issue to re-up the values with additional test coverage
          statements: 84,
          branches: 74,
          functions: 87,
          lines: 84,
        },
        // We have many tests here that commonly time out
        testTimeout: 60_000,
        coveragePathIgnorePatterns: [
          // Mostly wrappers around the SDK, which get mocked in unit tests
          '<rootDir>/lib/api/aws-auth/sdk.ts',

          // Files generated by cli-args-gen
          '<rootDir>/lib/parse-command-line-arguments.ts',
          '<rootDir>/lib/user-input.ts',
          '<rootDir>/lib/convert-to-user-input.ts',
        ],
        testEnvironment: './test/jest-bufferedconsole.ts',
        setupFilesAfterEnv: ['<rootDir>/test/jest-setup-after-env.ts'],
      },
    }),

    // Append a specific version string for testing
    nextVersionCommand: 'tsx ../../projenrc/next-version.ts maybeRc',
  }),
);

// Eslint rules
cli.eslint?.addRules({
  '@cdklabs/no-throw-default-error': ['error'],
});
cli.eslint?.addOverride({
  files: ['./test/**'],
  rules: {
    '@cdklabs/no-throw-default-error': 'off',
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

cli.gitignore.addPatterns(...ADDITIONAL_CLI_IGNORE_PATTERNS);

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
cli.preCompileTask.prependExec('ts-node --prefer-ts-exts scripts/user-input-gen.ts');

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
    devDeps: ['aws-cdk-lib', cli, 'constructs'],
    disableTsconfig: true,
    nextVersionCommand: `tsx ../../../projenrc/next-version.ts copyVersion:../../../${cliPackageJson} append:-alpha.0`,
    // Watch 2 directories at once
    releasableCommits: pj.ReleasableCommits.featuresAndFixes(`. ../../${cli.name}`),
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
  }),
);

// Do include all .ts files inside init-templates
cliLib.npmignore?.addPatterns('!lib/init-templates/**/*.ts');

cliLib.gitignore.addPatterns(
  ...ADDITIONAL_CLI_IGNORE_PATTERNS,
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

const TOOLKIT_LIB_EXCLUDE_PATTERNS = [
  'lib/init-templates/*/typescript/*/*.template.ts',
];

const toolkitLib = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps({
      private: true,
    }),
    parent: repo,
    name: '@aws-cdk/toolkit-lib',
    description: 'AWS CDK Programmatic Toolkit Library',
    srcdir: 'lib',
    deps: [
      cloudAssemblySchema,
      cloudFormationDiff,
      cxApi,
      '@aws-cdk/region-info',
      `@aws-sdk/client-appsync@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-cloudformation@${CLI_SDK_V3_RANGE}`,
      `@aws-sdk/client-cloudwatch-logs@${CLI_SDK_V3_RANGE}`,
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
      '@jsii/check-node',
      '@smithy/middleware-endpoint',
      '@smithy/node-http-handler',
      '@smithy/property-provider',
      '@smithy/shared-ini-file-loader',
      '@smithy/util-retry',
      '@smithy/util-stream',
      '@smithy/util-waiter',
      'archiver',
      'camelcase@^6', // Non-ESM
      cdkAssets,
      'cdk-from-cfn',
      'chalk@^4',
      'chokidar@^3',
      'decamelize@^5', // Non-ESM
      'fs-extra@^9',
      'glob',
      'json-diff',
      'minimatch',
      'p-limit@^3',
      'promptly',
      'proxy-agent',
      'semver',
      'split2',
      'strip-ansi@^6',
      'table@^6',
      'uuid',
      'wrap-ansi@^7', // Last non-ESM version
      'yaml@^1',
      'yargs@^15',
    ],
    devDeps: [
      cdkBuildTools,
      '@smithy/types',
      '@types/fs-extra',
      '@types/split2',
      cli,
      'aws-cdk-lib',
      'aws-sdk-client-mock',
      'esbuild',
      'typedoc',
    ],
    // Watch 2 directories at once
    releasableCommits: pj.ReleasableCommits.featuresAndFixes(`. ../../${cli.name}`),
    eslintOptions: {
      dirs: ['lib'],
      ignorePatterns: [
        ...TOOLKIT_LIB_EXCLUDE_PATTERNS,
        '*.d.ts',
      ],
    },
    jestOptions: jestOptionsForProject({
      jestConfig: {
        testEnvironment: './test/_helpers/jest-bufferedconsole.ts',
        coverageThreshold: {
          // this is very sad but we will get better
          statements: 85,
          branches: 76,
          functions: 77,
          lines: 85,
        },
      },
    }),
    tsconfig: {
      compilerOptions: {
        target: 'es2022',
        lib: ['es2022', 'esnext.disposable'],
        module: 'NodeNext',
        esModuleInterop: false,
      },
    },
  }),
);

// Eslint rules
toolkitLib.eslint?.addRules({
  '@cdklabs/no-throw-default-error': ['error'],
  'import/no-restricted-paths': ['error', {
    zones: [{
      target: './',
      from: '../../aws-cdk',
      message: 'All `aws-cdk` code must be used via lib/api/aws-cdk.ts',
    }],
  }],
});
toolkitLib.eslint?.addOverride({
  files: ['./test/**'],
  rules: {
    '@cdklabs/no-throw-default-error': 'off',
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

toolkitLib.postCompileTask.exec('node build-tools/bundle.mjs');
// Smoke test built JS files
toolkitLib.postCompileTask.exec('node ./lib/index.js >/dev/null 2>/dev/null </dev/null');
toolkitLib.postCompileTask.exec('node ./lib/api/aws-cdk.js >/dev/null 2>/dev/null </dev/null');

// Do include all .ts files inside init-templates
toolkitLib.npmignore?.addPatterns(
  // Explicitly allow all required files
  '!build-info.json',
  '!db.json.gz',
  '!lib/api/bootstrap/bootstrap-template.yaml',
  '*.d.ts',
  '*.d.ts.map',
  '!lib/*.js',
  '!LICENSE',
  '!NOTICE',
  '!THIRD_PARTY_LICENSES',
);

toolkitLib.gitignore.addPatterns(
  ...ADDITIONAL_CLI_IGNORE_PATTERNS,
  'docs',
  'build-info.json',
  'lib/**/*.wasm',
  'lib/**/*.yaml',
  'lib/**/*.js.map',
  '!test/_fixtures/**/app.js',
  '!test/_fixtures/**/cdk.out',
);

// Exclude takes precedence over include
for (const tsconfig of [toolkitLib.tsconfigDev]) {
  for (const pat of CLI_LIB_EXCLUDE_PATTERNS) {
    tsconfig?.addExclude(pat);
  }
}

toolkitLib.addTask('docs', {
  exec: 'typedoc lib/index.ts --excludeExternals --excludePrivate --excludeProtected --excludeInternal',
});
toolkitLib.addTask('publish-local', {
  exec: './build-tools/package.sh',
});

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
    devDeps: ['aws-cdk-lib', cli, 'constructs', '@aws-cdk/integ-runner'],
    nextVersionCommand: `tsx ../../../projenrc/next-version.ts copyVersion:../../../${cliPackageJson}`,
    // Watch 2 directories at once
    releasableCommits: pj.ReleasableCommits.featuresAndFixes(`. ../../${cli.name}`),

    jestOptions: jestOptionsForProject({
      jestConfig: {
        coverageThreshold: {
          branches: 62,
        },
      },
    }),
  }),
);

(() => {
  const integ = cdkCliWrapper.addTask('integ', {
    exec: 'integ-runner --language javascript',
  });
  cdkCliWrapper.testTask.spawn(integ);
})();

//////////////////////////////////////////////////////////////////////

const cdkAliasPackage = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: 'cdk',
    description: 'AWS CDK Toolkit',
    srcdir: 'lib',
    deps: [cli],
    nextVersionCommand: `tsx ../../projenrc/next-version.ts copyVersion:../../${cliPackageJson}`,
    // Watch 2 directories at once
    releasableCommits: pj.ReleasableCommits.featuresAndFixes(`. ../${cli.name}`),
  }),
);
void cdkAliasPackage;

//////////////////////////////////////////////////////////////////////

// The pj.github.Dependabot component is only for a single Node project,
// but we need multiple non-Node projects
new pj.YamlFile(repo, '.github/dependabot.yml', {
  obj: {
    version: 2,
    updates: ['pip', 'maven', 'nuget'].map((pkgEco) => ({
      'package-ecosystem': pkgEco,
      'directory': '/',
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
  approvalEnvironment: APPROVAL_ENVIRONMENT,
  testEnvironment: TEST_ENVIRONMENT,
  buildRunsOn: POWERFUL_RUNNER,
  testRunsOn: POWERFUL_RUNNER,
  expectNewCliLibVersion: true,

  localPackages: [
    // CloudAssemblySchema is not in this list because in the way we're doing
    // Verdaccio now, its 0.0.0 version will shadow the ACTUAL published version
    // that aws-cdk-lib depends on, and so will not be found.
    //
    // Not sure if that will cause problems yet.
    cloudFormationDiff.name,
    cdkAssets.name,
    cli.name,
    cliLib.name,
    cdkAliasPackage.name,
  ],
});

new CodeCovWorkflow(repo, {
  restrictToRepos: ['aws/aws-cdk-cli'],
  packages: [cli.name],
});

repo.synth();
