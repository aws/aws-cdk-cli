import * as pj from 'projen';
import { yarn } from 'cdklabs-projen-project-types';
import { ESLINT_RULES } from './.projenrc/eslint';
import { JsiiBuild } from './projenrc/jsii';
import { BundleCli } from './projenrc/bundle';
import { Stability } from 'projen/lib/cdk';

// 5.7 sometimes gives a weird error in `ts-jest` in `@aws-cdk/cli-lib-alpha`
// https://github.com/microsoft/TypeScript/issues/60159
const TYPESCRIPT_VERSION = "5.6";

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
  );
  x.eslint?.addPlugins(
    '@typescript-eslint',
    '@cdklabs',
    '@stylistic',
    'jest',
  );
  x.eslint?.addExtends(
    'plugin:jest/recommended',
  );
  x.eslint?.addIgnorePattern('*.generated.ts');
  x.eslint?.addRules(ESLINT_RULES);

  // Prettier needs to be turned off for now, there's too much code that doesn't conform to it
  x.eslint?.addRules({ 'prettier/prettier': ['off'] });

  x.addDevDeps('prettier@^2.8');
  return x;
}

const workflowRunsOn = [
  'ubuntu-latest',
  // 'awscdk-service-spec_ubuntu-latest_32-core',
];

/**
 * Shared jest config
 *
 * Must be a function because these structures will be mutated in-place inside projen
 */
function sharedJestConfig(): pj.javascript.JestConfigOptions {
  return {
    maxWorkers: '80%',
    testEnvironment: 'node',
    coverageThreshold: {
      global: {
        branches: 80,
        statements: 80,
      },
    } as any,
    collectCoverage: true,
    coverageReporters: [
      'text-summary', // for console summary
      'cobertura', // for codecov. see https://docs.codecov.com/docs/code-coverage-with-javascript
      'html', // for local deep dive
    ],
    testMatch: ['<rootDir>/test/**/?(*.)+(test).ts'],
    coveragePathIgnorePatterns: ['\\.generated\\.[jt]s$', '<rootDir>/test/', '.warnings.jsii.js$', '/node_modules/'],
    reporters: ['default', ['jest-junit', { suiteName: 'jest tests', outputDirectory: 'coverage' }]] as any,

    // Randomize test order: this will catch tests that accidentally pass or
    // fail because they rely on shared mutable state left by other tests
    // (files on disk, global mocks, etc).
    randomize: true,

    testTimeout: 60_000,
  };
}

const repo = configureProject(
  new yarn.Monorepo({
    projenrcTs: true,
    name: 'aws-cdk-cli',
    description: "Monorepo for the AWS CDK's CLI",
    repository: 'https://github.com/aws/aws-cdk-cli',

    defaultReleaseBranch: 'main',
    devDeps: [
      'cdklabs-projen-project-types@^0.1.213',
    ],
    vscodeWorkspace: true,
    // nx: true,

    eslintOptions: {
      // prettier: true,
      dirs: ['lib'],
      devdirs: ['test'],

    },

    /*
    // Too many files don't match prettier
    prettier: true,
    prettierOptions: {
      settings: {
        printWidth: 120,
        singleQuote: true,
        trailingComma: pj.javascript.TrailingComma.ALL,
      },
    },
    */
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
      releaseTrigger: pj.release.ReleaseTrigger.scheduled({
        schedule: '11 8 * * 5',
      }),
    },

    githubOptions: {
      mergify: false,
      mergeQueue: true,
      pullRequestLintOptions: {
        semanticTitleOptions: {
          types: ['feat', 'fix', 'chore', 'refactor'],
        },
      },
    },
  }),
);

/**
 * Generic CDK props
 *
 * Must be a function because the structures of jestConfig will be mutated
 * in-place inside projen
 */
function genericCdkProps() {
  return {
    keywords: ['aws', 'cdk'],
    homepage: 'https://github.com/aws/aws-cdk',
    authorName: 'Amazon Web Services',
    authorUrl: 'https://aws.amazon.com',
    authorOrganization: true,
    releasableCommits: pj.ReleasableCommits.featuresAndFixes('.'),
    jestOptions: {
      configFilePath: 'jest.config.json',
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
  } satisfies Partial<yarn.TypeScriptWorkspaceOptions>;
}

//////////////////////////////////////////////////////////////////////

const SCHEMA_VERSION: typeof import('./packages/@aws-cdk/cloud-assembly-schema/schema/version.json') = require('./packages/@aws-cdk/cloud-assembly-schema/schema/version.json');

const cloudAssemblySchema = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/cloud-assembly-schema',
    description: 'Schema for the protocol between CDK framework and CDK CLI',
    srcdir: 'lib',
    bundledDeps: ['jsonschema', 'semver'],
    devDeps: ['@types/semver', 'mock-fs', 'typescript-json-schema', 'tsx'],
    disableTsconfig: true,
    // This forces every release to be the major version from the data file
    minMajorVersion: SCHEMA_VERSION.revision,
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
    moduleName: `github.com/cdklabs/cloud-assembly-schema-go`,
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
    ...genericCdkProps(),
    private: true,
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
    ...genericCdkProps(),
    private: true,
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
    ...genericCdkProps(),
    private: true,
    parent: repo,
    name: '@aws-cdk/node-bundle',
    description: 'Tool for generating npm-shrinkwrap from yarn.lock',
    deps: ['esbuild', 'fs-extra@^9', 'license-checker', 'madge', 'shlex', 'yargs'],
    devDeps: ['@types/license-checker', '@types/madge', '@types/fs-extra@^9', 'jest-junit', 'standard-version'],
  }),
);
// Too many console statements
nodeBundle.eslint?.addRules({ 'no-console': ['off'] });

//////////////////////////////////////////////////////////////////////

// This should be deprecated, but only after the move
const cdkBuildTools = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    private: true,
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
    ...genericCdkProps(),
    private: true,
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
        '@aws-sdk/client-ecr',
        '@aws-sdk/client-s3',
        '@aws-sdk/client-secrets-manager',
        '@aws-sdk/client-sts',
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

// This package happens do something only slightly naughty
cdkAssets.eslint?.addRules({ 'jest/no-export': ['off'] });

//////////////////////////////////////////////////////////////////////

let CLI_SDK_VERSION: '2' | '3' = ('3' as any);

// Specifically this and not ^ because between 3.699 and 3.730 some change has
// been made that causes our nifty network interception via 'sinon' to fail.
const CLI_SDK_V3_RANGE = '3.699.0';

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
      'source-map-support',
      'strip-ansi@^6',
      'table',
      'uuid',
      'wrap-ansi@^7',  // Last non-ESM version
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
    jestOptions: {
      ...genericCdkProps().jestOptions,
      jestConfig: {
        ...genericCdkProps().jestOptions.jestConfig,
        testEnvironment: './test/jest-bufferedconsole.ts',
      },
    },
  }),
);

cli.gitignore.addPatterns('build-info.json');

const cliPackageJson = `${__dirname}/${cli.workspaceDirectory}/package.json`;

cli.preCompileTask.prependExec('./generate.sh');
cli.preCompileTask.prependExec('ts-node scripts/user-input-gen.ts');

const includeCliResourcesCommands = [
  `cp $(node -p 'require.resolve("cdk-from-cfn/index_bg.wasm")') ./lib/`,
  `cp $(node -p 'require.resolve("@aws-cdk/aws-service-spec/db.json.gz")') ./`,
];

for (const resourceCommand of includeCliResourcesCommands) {
  cli.postCompileTask.exec(resourceCommand);
}

Object.assign(cli.jest?.config ?? {}, {
  coveragePathIgnorePatterns: [
    ...(cli.jest?.config.coveragePathIgnorePatterns ?? []),
    // Mostly wrappers around the SDK, which get mocked in unit tests
    "<rootDir>/lib/api/aws-auth/sdk.ts",
  ],
  setupFilesAfterEnv: ["<rootDir>/test/jest-setup-after-env.ts"],
});

new BundleCli(cli, {
  externals: {
    optionalDependencies: [
      'fsevents',
    ],
  },
  allowedLicenses: [
    "Apache-2.0",
    "MIT",
    "BSD-3-Clause",
    "ISC",
    "BSD-2-Clause",
    "0BSD",
    "MIT OR Apache-2.0",
  ],
  dontAttribute: "^@aws-cdk/|^@cdklabs/|^cdk-assets$|^cdk-cli-wrapper$",
  test: "bin/cdk --version",
  entryPoints: [
    "lib/index.js"
  ],
  minifyWhitespace: true,
});

// Exclude takes precedence over include
for (const tsconfig of [cli.tsconfig, cli.tsconfigDev]) {
  tsconfig?.addExclude("lib/init-templates/*/typescript/*/*.template.ts");
  tsconfig?.addExclude("test/integ/cli/sam_cdk_integ_app/**/*");
  tsconfig?.addExclude("vendor/**/*");
}

//////////////////////////////////////////////////////////////////////

const CLI_LIB_EXCLUDE_PATTERNS = [
  "lib/init-templates/*/typescript/*/*.template.ts",
];

const cliLib = configureProject(
  new yarn.TypeScriptWorkspace({
    ...genericCdkProps(),
    parent: repo,
    name: '@aws-cdk/cli-lib-alpha',
    description: 'AWS CDK Programmatic CLI library',
    srcdir: 'lib',
    devDeps: ['aws-cdk-lib', cli, 'constructs'],
    disableTsconfig: true,
    nextVersionCommand: `tsx ${__dirname}/projenrc/copy-version-from.ts ${cliPackageJson}`,
    // Watch 2 directories at once
    releasableCommits: pj.ReleasableCommits.featuresAndFixes(`. ../../${cli.name}`),
  }),
);

new JsiiBuild(cliLib, {
  jsiiVersion: TYPESCRIPT_VERSION,
  publishToNuget: {
    dotNetNamespace: "Amazon.CDK.Cli.Lib.Alpha",
    "packageId": "Amazon.CDK.Cli.Lib.Alpha",
    "iconUrl": "https://raw.githubusercontent.com/aws/aws-cdk/main/logo/default-256-dark.png"
  },
  publishToMaven: {
    javaPackage: "software.amazon.awscdk.cli.lib.alpha",
    "mavenGroupId": "software.amazon.awscdk",
    "mavenArtifactId": "cdk-cli-lib-alpha"
  },
  publishToPypi: {
    "distName": "aws-cdk.cli-lib-alpha",
    "module": "aws_cdk.cli_lib_alpha",
  },
  pypiClassifiers: [
    "Framework :: AWS CDK",
    "Framework :: AWS CDK :: 2"
  ],
  publishToGo: {
    "moduleName": "github.com/aws/aws-cdk-go",
    "packageName": "awscdkclilibalpha"
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
cliLib.postCompileTask.exec(`cp $(node -p 'require.resolve("aws-cdk/build-info.json")') .`);
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
    ...genericCdkProps(),
    parent: repo,
    private: true,
    name: '@aws-cdk/cdk-cli-wrapper',
    description: 'CDK CLI Wrapper Library',
    srcdir: 'lib',
    devDeps: ['aws-cdk-lib', cli, 'constructs', '@aws-cdk/integ-runner'],
    nextVersionCommand: `tsx ${__dirname}/projenrc/copy-version-from.ts ${cliPackageJson}`,
    // Watch 2 directories at once
    releasableCommits: pj.ReleasableCommits.featuresAndFixes(`. ../../${cli.name}`),
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
    nextVersionCommand: `tsx ${__dirname}/projenrc/copy-version-from.ts ${cliPackageJson}`,
    // Watch 2 directories at once
    releasableCommits: pj.ReleasableCommits.featuresAndFixes(`. ../${cli.name}`),
  }),
);
void cdkAliasPackage;

//////////////////////////////////////////////////////////////////////

// The pj.github.Dependabot component is only for a single Node project,
// but we need multiple non-Node projects
new pj.YamlFile(repo, ".github/dependabot.yml", {
  obj: {
    version: 2,
    updates: ['pip', 'maven', 'nuget'].map((pkgEco) => ({
      'package-ecosystem': pkgEco,
      directory: '/',
      schedule: { interval: 'weekly' },
      labels: ['auto-approve'],
      'open-pull-requests-limit': 5,
    })),
  },
  committed: true,
});

repo.synth();
