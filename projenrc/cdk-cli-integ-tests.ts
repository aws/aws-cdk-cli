import { yarn } from 'cdklabs-projen-project-types';
import type { javascript, Project } from 'projen';
import { Component, github, TextFile } from 'projen';

/**
 * Amends the test task with special provisions for unit testing.
 */
export function fixupTestTask(project: Project, taskName = 'test'): void {
  project.tasks.tryFind(taskName)?.env('TESTING_CDK', '1');
  project.tasks.tryFind(taskName)?.addCondition('[ "$NO_UNIT_TESTS" != "1" ]');
}

const NOT_FLAGGED_EXPR = "!contains(github.event.pull_request.labels.*.name, 'pr/exempt-integ-test')";

/**
 * Common workflow steps
 */
function downloadArtifactsSteps(): github.workflows.JobStep[] {
  return [
    {
      name: 'Download build artifacts',
      uses: 'actions/download-artifact@v4',
      with: {
        name: 'build-artifact',
        path: 'packages',
      },
    },
    {
      name: 'Download scripts',
      uses: 'actions/download-artifact@v4',
      with: {
        name: 'script-artifact',
        path: '.projen',
      },
    },
  ];
}

function setupNodeStep(nodeVersion: string): github.workflows.JobStep {
  return {
    name: 'Setup Node.js',
    uses: 'actions/setup-node@v4',
    with: {
      'node-version': nodeVersion,
    },
  };
}

function awsAuthStep(props: CdkCliIntegTestsWorkflowProps, sessionName: string): github.workflows.JobStep {
  return {
    name: 'Authenticate Via OIDC Role',
    id: 'creds',
    uses: 'aws-actions/configure-aws-credentials@v4',
    with: {
      'aws-region': 'us-east-1',
      'role-duration-seconds': props.enableAtmosphere ? 60 * 60 : 4 * 60 * 60,
      // Expect this in Environment Variables
      'role-to-assume': props.enableAtmosphere ? props.enableAtmosphere.oidcRoleArn : '${{ vars.AWS_ROLE_TO_ASSUME_FOR_TESTING }}',
      'role-session-name': sessionName,
      'output-credentials': true,
    },
  };
}

function gitIdentityStep(): github.workflows.JobStep {
  // This is necessary for the init tests to succeed, they set up a git repo.
  return {
    name: 'Set git identity',
    run: [
      'git config --global user.name "aws-cdk-cli-integ"',
      'git config --global user.email "noreply@example.com"',
    ].join('\n'),
  };
}

function verdaccioSteps(): github.workflows.JobStep[] {
  return [
    {
      name: 'Prepare Verdaccio',
      run: 'chmod +x .projen/prepare-verdaccio.sh && .projen/prepare-verdaccio.sh',
    },
    {
      name: 'Download and install the test artifact',
      run: 'npm install @aws-cdk-testing/cli-integ',
    },
  ];
}

function determineVersionsStep(): github.workflows.JobStep {
  return {
    name: 'Determine latest package versions',
    id: 'versions',
    run: [
      'CLI_VERSION=$(cd ${TMPDIR:-/tmp} && npm view aws-cdk version)',
      'echo "CLI version: ${CLI_VERSION}"',
      'echo "cli_version=${CLI_VERSION}" >> $GITHUB_OUTPUT',
      'LIB_VERSION=$(cd ${TMPDIR:-/tmp} && npm view aws-cdk-lib version)',
      'echo "lib version: ${LIB_VERSION}"',
      'echo "lib_version=${LIB_VERSION}" >> $GITHUB_OUTPUT',
    ].join('\n'),
  };
}

function testEnvVars(props: CdkCliIntegTestsWorkflowProps): Record<string, string> {
  return {
    JSII_SILENCE_WARNING_DEPRECATED_NODE_VERSION: 'true',
    JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION: 'true',
    JSII_SILENCE_WARNING_KNOWN_BROKEN_NODE_VERSION: 'true',
    DOCKERHUB_DISABLED: 'true',
    ...(props.enableAtmosphere ?
      {
        CDK_INTEG_ATMOSPHERE_ENABLED: 'true',
        CDK_INTEG_ATMOSPHERE_ENDPOINT: props.enableAtmosphere.endpoint,
        CDK_INTEG_ATMOSPHERE_POOL: props.enableAtmosphere.pool,
      } :
      {
        AWS_REGIONS: ['us-east-2', 'eu-west-1', 'eu-north-1', 'ap-northeast-1', 'ap-south-1'].join(','),
      }),
    CDK_MAJOR_VERSION: '2',
    RELEASE_TAG: 'latest',
    GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    INTEG_LOGS: 'logs',
  };
}

/**
 * Options for atmosphere service usage.
 */
export interface AtmosphereOptions {
  /**
   * Atmosphere service endpoint.
   */
  readonly endpoint: string;
  /**
   * Which pool to retrieve environments from.
   */
  readonly pool: string;
  /**
   * OIDC role to assume prior to using atmosphere. Must be allow listed
   * on the service endpoint.
   */
  readonly oidcRoleArn: string;
}

export interface CdkCliIntegTestsWorkflowProps {
  /**
   * Runners for the workflow
   */
  readonly buildRunsOn: string;

  /**
   * Runners for the workflow
   */
  readonly testRunsOn: string;

  /**
   * GitHub environment name for approvals
   *
   * MUST be configured to require manual approval.
   */
  readonly approvalEnvironment: string;

  /**
   * GitHub environment name for running the tests
   *
   * MUST be configured without approvals, and with the following vars and secrets:
   *
   * - vars: AWS_ROLE_TO_ASSUME_FOR_TESTING
   *
   * And the role needs to be configured to allow the AssumeRole operation.
   */
  readonly testEnvironment: string;

  /**
   * The official repo this workflow is used for
   */
  readonly sourceRepo: string;

  /**
   * If given, allows accessing upstream versions of these packages
   *
   * @default - No upstream versions
   */
  readonly allowUpstreamVersions?: Array<Project>;

  /**
   * Enable atmosphere service to retrieve AWS test environments.
   *
   * @default - atmosphere is not used
   */
  readonly enableAtmosphere?: AtmosphereOptions;

  /**
   * Specifies the maximum number of workers the worker-pool will spawn for running tests.
   *
   * @default - the cli integ test package determines a sensible default
   */
  readonly maxWorkers?: string;

  /**
   * Additional Node versions to some particular suites against.
   *
   * Use the version syntax of `setup-node`. `'lts/*'` is always included automatically.
   *
   * @see https://github.com/actions/setup-node?tab=readme-ov-file#supported-version-syntax
   */
  readonly additionalNodeVersionsToTest?: string[];
}

/**
 * Add a workflow for running the tests
 *
 * This MUST be a separate workflow that runs in privileged context. We have a couple
 * of options:
 *
 * - `workflow_run`: we can trigger a privileged workflow run after the unprivileged
 *   `pull_request` workflow finishes and reuse its output artifacts. The
 *   problem is that the second run is disconnected from the PR so we would need
 *   to script in visibility for approvals and success (by posting comments, for
 *   example)
 * - Use only a `pull_request_target` workflow on the PR: this either would run
 *   a privileged workflow on any user code submission (might be fine given the
 *   workflow's `permissions`, but I'm sure this will make our security team uneasy
 *   anyway), OR this would mean any build needs human confirmation which means slow
 *   feedback.
 * - Use a `pull_request` for a regular fast-feedback build, and a separate
 *   `pull_request_target` for the integ tests. This means we're building twice.
 *
 * Ultimately, our build isn't heavy enough to put in a lot of effort deduping
 * it, so we'll go with the simplest solution which is the last one: 2
 * independent workflows.
 *
 * projen doesn't make it easy to copy the relevant parts of the 'build' workflow,
 * so they're unfortunately duplicated here.
 */
export class CdkCliIntegTestsWorkflow extends Component {
  private workflow: github.GithubWorkflow;
  private readonly JOB_PREPARE = 'prepare';
  private readonly maxWorkersArg: string = '';

  constructor(repo: javascript.NodeProject, private readonly props: CdkCliIntegTestsWorkflowProps) {
    super(repo);

    const buildWorkflow = repo.buildWorkflow;
    this.workflow = repo.github?.addWorkflow('integ')!;
    if (!buildWorkflow || !this.workflow) {
      throw new Error('Expected build and run tests workflow');
    }
    ((buildWorkflow as any).workflow as github.GithubWorkflow);

    const localPackages = repo.subprojects
      .filter(p => p instanceof yarn.TypeScriptWorkspace && !p.isPrivatePackage)
      .map(p => p.name);
    const upstreamVersions = (this.props.allowUpstreamVersions ?? [])?.map(p => p.name);
    upstreamVersions.forEach((pack) => {
      if (!localPackages.includes(pack)) {
        throw new Error(`Package in allowUpstreamVersions is not a local monorepo package: ${pack}`);
      }
    });

    if (this.props.maxWorkers) {
      this.maxWorkersArg = ` --maxWorkers=${this.props.maxWorkers}`;
    }

    const verdaccioConfig = {
      storage: './storage',
      auth: { htpasswd: { file: './htpasswd' } },
      uplinks: { npmjs: { url: 'https://registry.npmjs.org/' } },
      packages: {} as Record<string, unknown>,
    };

    for (const pack of localPackages) {
      const allowUpstream = upstreamVersions.includes(pack);

      verdaccioConfig.packages[pack] = {
        access: '$all',
        publish: '$all',
        proxy: allowUpstream ? 'npmjs' : 'none',
      };
    }
    verdaccioConfig.packages['**'] = {
      access: '$all',
      proxy: 'npmjs',
    };

    // bash only expands {...} if there's a , in there, otherwise it will leave the
    // braces in literally. So we need to do case analysis here. Thanks, I hate it.
    const tarballBashExpr = localPackages.length === 1
      ? `packages/${localPackages[0]}/dist/js/*.tgz`
      : `packages/{${localPackages.join(',')}}/dist/js/*.tgz`;

    // Add a script that will upload all packages to Verdaccio.
    //
    // This is a script because we want to be able to update it on a per-branch basis
    // (so this information cannot live in the workflow, because that only takes effect after
    // a PR changing it has been merged to `main`).
    //
    // It also cannot be a simple projen task, because we run the tests disconnected
    // from a source checkout and we need to transfer artifacts from the 'prepare' job to
    // the 'run' job.
    //
    // So we create a script file that we send as an artifact, and run in the
    // 'run' job.

    new TextFile(repo, '.projen/prepare-verdaccio.sh', {
      executable: true,
      lines: [
        '#!/bin/bash',
        'npm install -g verdaccio pm2',
        'mkdir -p $HOME/.config/verdaccio',
        `echo '${JSON.stringify(verdaccioConfig)}' > $HOME/.config/verdaccio/config.yaml`,
        'pm2 start verdaccio -- --config $HOME/.config/verdaccio/config.yaml',
        'sleep 5', // Wait for Verdaccio to start
        // Configure NPM to use local registry
        'echo \'//localhost:4873/:_authToken="MWRjNDU3OTE1NTljYWUyOTFkMWJkOGUyYTIwZWMwNTI6YTgwZjkyNDE0NzgwYWQzNQ=="\' > ~/.npmrc',
        'echo \'registry=http://localhost:4873/\' >> ~/.npmrc',
        // Find and locally publish all tarballs
        `for pkg in ${tarballBashExpr}; do`,
        '  npm publish --loglevel=warn $pkg',
        'done',
      ],
    });

    this.workflow.on({
      pullRequestTarget: {
        branches: [],
      },
      // Needs to trigger and report success on merge queue builds as well
      mergeGroup: {},
      // Never hurts to be able to run this manually
      workflowDispatch: {},
    });
    // The 'build' part runs on the 'integ-approval' environment, which requires
    // approval. The actual runs access the real environment, not requiring approval
    // anymore.
    //
    // This is for 2 reasons:
    // - The build job is the first one that runs. That means you get asked approval
    //   immediately after push, instead of 5 minutes later after the build completes.
    // - The build job is only one job, versus the tests which are a matrix build.
    //   If the matrix test job needs approval, the Pull Request timeline gets spammed
    //   with an approval request for every individual run.

    this.workflow.addJob(this.JOB_PREPARE, {
      environment: this.props.approvalEnvironment,
      runsOn: [this.props.buildRunsOn],
      permissions: {
        contents: github.workflows.JobPermission.READ,
      },
      env: {
        CI: 'true',
        DEBUG: 'true',
        TESTING_CDK: '1',
        NO_UNIT_TESTS: '1',
      },
      // Don't run again on the merge queue, we already got confirmation that it works and the
      // tests are quite expensive.
      if: `github.event_name != 'merge_group' && ${NOT_FLAGGED_EXPR}`,
      steps: [
        {
          name: 'Checkout',
          uses: 'actions/checkout@v4',
          with: {
            // IMPORTANT! This must be `head.sha` not `head.ref`, otherwise we
            // are vulnerable to a TOCTOU attack.
            ref: '${{ github.event.pull_request.head.sha }}',
            repository: '${{ github.event.pull_request.head.repo.full_name }}',
          },
        },
        // We used to fetch tags from the repo using 'checkout', but if it's a fork
        // the tags won't be there, so we have to fetch them from upstream.
        //
        // The tags are necessary to realistically bump versions
        {
          name: 'Fetch tags from origin repo',
          run: [
            // Can be either aws/aws-cdk-cli or aws/aws-cdk-cli-testing
            // (Must clone over HTTPS because we have no SSH auth set up)
            `git remote add upstream https://github.com/${this.props.sourceRepo}.git`,
            'git fetch upstream \'refs/tags/*:refs/tags/*\'',
          ].join('\n'),
        },
        {
          name: 'Setup Node.js',
          uses: 'actions/setup-node@v4',
          with: {
            'node-version': 'lts/*',
            'cache': 'npm',
          },
        },
        {
          name: 'Install dependencies',
          run: 'yarn install --check-files',
        },
        {
          name: 'Bump to realistic versions',
          run: 'yarn workspaces run bump',
          env: {
            TESTING_CANDIDATE: 'true',
          },
        },
        {
          name: 'build',
          run: 'npx projen build',
          env: {
            // This is necessary to prevent projen from resetting the version numbers to
            // 0.0.0 during its synthesis.
            RELEASE: 'true',
          },
        },
        {
          name: 'Upload artifact',
          uses: 'actions/upload-artifact@v4.4.0',
          with: {
            name: 'build-artifact',
            path: 'packages/**/dist/js/*.tgz',
            overwrite: 'true',
          },
        },
        {
          name: 'Upload scripts',
          uses: 'actions/upload-artifact@v4.4.0',
          with: {
            'name': 'script-artifact',
            'path': '.projen/*.sh',
            'overwrite': 'true',
            'include-hidden-files': true,
          },
        },
      ],
    });

    // Ensure this is an array
    const additionalNodeVersionsToTest = this.props.additionalNodeVersionsToTest ?? [];

    const testJobs = [
      // cli-integ-tests
      this.addMatrixJob('cli', {
        domain: {
          suite: ['cli-integ-tests'],
          shards: 12,
        },
      }),

      // toolkit-lib
      this.addMatrixJob('toolkit-lib', {
        domain: {
          suite: [
            'toolkit-lib-integ-tests',
          ],
          node: ['lts/*', ...additionalNodeVersionsToTest],
        },
      }),

      // telemetry
      this.addMatrixJob('telemetry', {
        extraEnv: {
          // We test telemetry, so need to enable it
          CDK_DISABLE_CLI_TELEMETRY: undefined,
        },
        domain: {
          suite: [
            'telemetry-integ-tests',
          ],
        },
      }),

      // init-templates
      this.addMatrixJob('init-templates', {
        domain: {
          suite: [
            'init-csharp',
            'init-fsharp',
            'init-go',
            'init-java',
            'init-javascript',
            'init-python',
            'init-typescript-app',
            'init-typescript-lib',
          ],
          node: ['lts/*'],
        },
        // Run the the typescript-app test with multiple Node versions
        include: additionalNodeVersionsToTest.map(node => ({
          suite: 'init-typescript-app',
          node,
        })),
      }),

      // We are finding that Amplify works on Node 20, but fails on Node >=22.10. Remove the 'lts/*' test and use a Node 20 for now.
      this.addMatrixJob('tool-integrations', {
        domain: {
          suite: ['tool-integrations'],
          node: ['20'],
        },
      }),
    ];

    // Add a job that collates all matrix jobs into a single status
    // This is required so that we can setup required status checks
    // and if we ever change the test matrix, we don't need to update
    // the status check configuration.
    this.workflow.addJob('integ', {
      runsOn: ['ubuntu-latest'],
      if: 'always()',
      needs: [...testJobs],
      permissions: {},
      steps: [
        ...testJobs.map(jobName => ({
          name: `${jobName} result`,
          run: `echo \${{ needs.${jobName}.result }}`,
        })),
        {
          // Don't fail the job if the test was successful or intentionally skipped
          if: `\${{ !(${testJobs.map(jobName => `contains(fromJSON('["success", "skipped"]'), needs.${jobName}.result)`).join(' && ')}) }}`,
          name: 'Set status based on test results',
          run: 'exit 1',
        },
      ],
    });
  }

  private addMatrixJob(testName: string, props: MatrixIntegTestProps): string {
    const jobName = `integ_${testName}`;

    let shard: any;
    let shardArg = '';
    let logName = 'logs-${{ matrix.suite }}-${{ matrix.node }}';
    if (props.domain.shards) {
      shard = Array(props.domain.shards).fill(0).map((_, i) => i + 1);
      shardArg = ` --shard="\${{ matrix.shard }}/${props.domain.shards}"`;
      logName += '-${{ matrix.shard }}';
    }

    this.workflow.addJob(jobName, {
      environment: this.props.testEnvironment,
      runsOn: [this.props.testRunsOn],
      needs: [this.JOB_PREPARE],
      permissions: {
        contents: github.workflows.JobPermission.READ,
        idToken: github.workflows.JobPermission.WRITE,
      },
      env: {
        // Otherwise Maven is too noisy
        MAVEN_ARGS: '--no-transfer-progress',
        // This is not actually a canary, but this prevents the tests from making
        // assumptions about the availability of source packages.
        IS_CANARY: 'true',
        CI: 'true',
        // Disable telemetry for test suites by default
        // This prevents unintentional throttling of requests and accidental failing of the telemetry test suite
        CDK_DISABLE_CLI_TELEMETRY: 'true',
        // add extra env at end so it can override
        ...props.extraEnv,
      },
      // Don't run again on the merge queue, we already got confirmation that it works and the
      // tests are quite expensive.
      if: `github.event_name != 'merge_group' && ${NOT_FLAGGED_EXPR}`,
      strategy: {
        failFast: false,
        matrix: {
          domain: {
            suite: props.domain.suite,
            node: props.domain.node ?? ['lts/*'],
            shard,
          },
          include: props.include,
          exclude: props.exclude,
        },
      },
      steps: [
        ...downloadArtifactsSteps(),
        setupNodeStep('${{ matrix.node }}'),
        {
          name: 'Set up JDK 18',
          if: 'matrix.suite == \'init-java\' || matrix.suite == \'cli-integ-tests\'',
          uses: 'actions/setup-java@v4',
          with: {
            'java-version': '18',
            'distribution': 'corretto',
          },
        },
        awsAuthStep(this.props, 'run-tests@aws-cdk-cli-integ'),
        gitIdentityStep(),
        ...verdaccioSteps(),
        determineVersionsStep(),
        {
          name: 'Run the test suite: ${{ matrix.suite }}',
          run: `npx run-suite${this.maxWorkersArg}${shardArg} --use-cli-release=\${{ steps.versions.outputs.cli_version }} --framework-version=\${{ steps.versions.outputs.lib_version }} \${{ matrix.suite }}`,
          env: testEnvVars(this.props),
        },
        {
          name: 'Set workflow summary',
          if: 'always()',
          run: [
            // Don't fail the glob expensaion if there are no .md files
            'if compgen -G "logs/md/*.md" > /dev/null; then',
            '  cat logs/md/*.md >> $GITHUB_STEP_SUMMARY;',
            'fi',
          ].join('\n'),
        },
        // Slugify artifact ID, because matrix.node will contain invalid chars
        {
          name: 'Slugify artifact id',
          if: 'always()',
          id: 'artifactid',
          run: [
            'slug=$(node -p \'process.env.INPUT.replace(/[^a-z0-9._-]/gi, "-")\')',
            'echo "slug=$slug" >> "$GITHUB_OUTPUT"',
          ].join('\n'),
          env: {
            INPUT: logName,
          },
        },
        {
          name: 'Upload logs',
          if: 'always()',
          uses: 'actions/upload-artifact@v4.4.0',
          id: 'logupload',
          with: {
            name: '${{ steps.artifactid.outputs.slug }}',
            path: 'logs/',
            overwrite: 'true',
          },
        },
        {
          name: 'Append artifact URL',
          if: 'always()',
          run: [
            'echo "" >> $GITHUB_STEP_SUMMARY',
            'echo "[Logs](${{ steps.logupload.outputs.artifact-url }})" >> $GITHUB_STEP_SUMMARY',
          ].join('\n'),
        },
      ],
    });
    return jobName;
  }
}

interface IntegTestJobDomain {
  /**
   * The test suites to run.
   */
  readonly suite: string[];

  /**
   * The number of shards to run the suites in.
   * @default - no sharding
   */
  readonly shards?: number;

  /**
   * The Node versions to test against.
   * @default ["lts/*"]
   */
  readonly node?: string[];
}

interface MatrixIntegTestProps {
  readonly domain: IntegTestJobDomain;
  readonly include?: github.workflows.JobMatrix['include'];
  readonly exclude?: github.workflows.JobMatrix['exclude'];
  readonly extraEnv?: Record<string, string | undefined>;
}
