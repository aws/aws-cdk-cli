import { Component, github, javascript } from "projen";

export interface CdkCliIntegTestsWorkflowProps {
  /**
   * Runners for the workflow
   */
  buildRunsOn: string;

  /**
   * Runners for the workflow
   */
  testRunsOn: string;

  /**
   * GitHub environment name for approvals
   *
   * MUST be configured to require manual approval.
   */
  approvalEnvironment: string;

  /**
   * GitHub environment name for running the tests
   *
   * MUST be configured without approvals, and with the following vars and secrets:
   *
   * - vars: AWS_ROLE_TO_ASSUME_FOR_TESTING
   *
   * And the role needs to be configured to allow the AssumeRole operation.
   */
  testEnvironment: string;

  /**
   * Packages that are locally transfered (we will never use the upstream versions)
   */
  localPackages: string[];
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
  constructor(repo: javascript.NodeProject, props: CdkCliIntegTestsWorkflowProps) {
    super(repo);

    const buildWorkflow = repo.buildWorkflow;
    const runTestsWorkflow = repo.github?.addWorkflow('build-and-integ');
    if (!buildWorkflow || !runTestsWorkflow) {
      throw new Error('Expected build and run tests workflow');
    }
    ((buildWorkflow as any).workflow as github.GithubWorkflow)

    runTestsWorkflow.on({
      pullRequestTarget: {
        branches: ['main'],
      },
    });
    // The 'build' part runs on the 'integ-approval' environment, which requires
    // approval. The actual runs access the real environment, not requiring approval
    // anymore.
    runTestsWorkflow.addJob('build', {
      environment: props.approvalEnvironment,
      runsOn: [props.buildRunsOn],
      permissions: {
        contents: github.workflows.JobPermission.READ,
      },
      env: {
        CI: 'true',
      },
      steps: [
        {
          name: 'Checkout',
          uses: 'actions/checkout@v4',
          with: {
            // IMPORTANT! This must be `head.sha` not `head.ref`, otherwise we
            // are vulnerable to a TOCTOU attack.
            ref: '${{ github.event.pull_request.head.sha }}',
            repository: '${{ github.event.pull_request.head.repo.full_name }}',
          }
        },
        {
          name: 'Setup Node.js',
          uses: 'actions/setup-node@v4',
          with: {
            'node-version': 'lts/*',
          }
        },
        {
          name: 'Install dependencies',
          run: 'yarn install --check-files',
        },
        {
          name: 'build',
          run: 'npx projen build',
        },
        {
          name: 'Upload artifact',
          uses: 'actions/upload-artifact@v4.4.0',
          with: {
            name: 'build-artifact',
            path: 'packages/**/dist/js/*.tgz',
            overwrite: 'true',
          }
        },
      ],
    });

    const verdaccioConfig = {
      storage: './storage',
      auth: { htpasswd: { file: './htpasswd' } },
      uplinks: { npmjs: { url: 'https://registry.npmjs.org/' } },
      packages: {} as Record<string, unknown>,
    };

    for (const pack of props.localPackages) {
      verdaccioConfig.packages[pack] = {
        access: '$all',
        publish: '$all',
        proxy: 'none',
      };
    };
    verdaccioConfig.packages['**'] = {
      access: '$all',
      proxy: 'npmjs',
    };

    runTestsWorkflow.addJob('integ', {
      environment: props.testEnvironment,
      runsOn: [props.testRunsOn],
      needs: ['build'],
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
      },
      strategy: {
        failFast: false,
        matrix: {
          domain: {
            suite: [
              'cli-integ-tests',
              'init-csharp',
              'init-fsharp',
              'init-go',
              'init-java',
              'init-javascript',
              'init-python',
              'init-typescript-app',
              'init-typescript-lib',
              'tool-integrations',
            ],
          },
        },
      },
      steps: [
        {
          name: 'Download build artifacts',
          uses: 'actions/download-artifact@v4',
          with: {
            name: 'build-artifact',
            path: 'packages',
          }
        },
        {
          name: 'Set up JDK 18',
          if: 'matrix.suite == \'init-java\' || matrix.suite == \'cli-integ-tests\'',
          uses: 'actions/setup-java@v4',
          with: {
            'java-version': '18',
            'distribution': 'corretto',
          },
        },
        {
          name: "Authenticate Via OIDC Role",
          id: "creds",
          uses: "aws-actions/configure-aws-credentials@v4",
          with: {
            "aws-region": "us-east-1",
            "role-duration-seconds": 4 * 60 * 60,
            // Expect this in Environment Variables
            "role-to-assume": "${{ vars.AWS_ROLE_TO_ASSUME_FOR_TESTING }}",
            "role-session-name": "run-tests@aws-cdk-cli-integ",
            "output-credentials": true,
          },
        },
        // This is necessary for the init tests to succeed, they set up a git repo.
        {
          name: 'Set git identity',
          run: [
            'git config --global user.name "aws-cdk-cli-integ"',
            'git config --global user.email "noreply@example.com"',
          ].join('\n'),
        },
        {
          name: 'Install Verdaccio',
          run: 'npm install -g verdaccio pm2',
        },
        {
          name: 'Create Verdaccio config',
          run: [
            'mkdir -p $HOME/.config/verdaccio',
            `echo '${JSON.stringify(verdaccioConfig)}' > $HOME/.config/verdaccio/config.yaml`,
          ].join('\n'),
        },
        {
          name: 'Start Verdaccio',
          run: [
            'pm2 start verdaccio -- --config $HOME/.config/verdaccio/config.yaml',
            'sleep 5 # Wait for Verdaccio to start',
          ].join('\n'),
        },
        {
          name: 'Configure npm to use local registry',
          run: [
            'npm config set registry http://localhost:4873/',
            'echo \'//localhost:4873/:_authToken="MWRjNDU3OTE1NTljYWUyOTFkMWJkOGUyYTIwZWMwNTI6YTgwZjkyNDE0NzgwYWQzNQ=="\' > ~/.npmrc',
          ].join('\n'),
        },
        {
          name: 'Find an locally publish all tarballs',
          run: `find packages -name \\*.tgz -print0 | xargs -0 -n1 npm publish --registry http://localhost:4873/`,
        },
        {
          name: "Download and install the test artifact",
          run: [
            `npm install @aws-cdk-testing/cli-integ`,
            // Move the installed files to the current directory, because as
            // currently configured the tests won't run from an installed
            // node_modules directory.
            "mv ./node_modules/@aws-cdk-testing/cli-integ/* .",
          ].join("\n"),
        },
        {
          name: "Determine latest CLI version",
          id: 'cli_version',
          run: [
            "CLI_VERSION=$(cd ${TMPDIR:-/tmp} && npm view aws-cdk version)",
            'echo "CLI version: ${CLI_VERSION}"',
            'echo "cli_version=${CLI_VERSION}" >> $GITHUB_OUTPUT',
          ].join('\n'),
        },
        {
          name: "Run the test suite: ${{ matrix.suite }}",
          run: [
            "bin/run-suite --use-cli-release=${{ steps.cli_version.outputs.cli_version }} ${{ matrix.suite }}",
          ].join('\n'),
          env: {
            // Concurrency only for long-running cli-integ-tests
            JEST_TEST_CONCURRENT: "${{ matrix.suite == 'cli-integ-tests' && 'true' || 'false' }}",
            JSII_SILENCE_WARNING_DEPRECATED_NODE_VERSION: 'true',
            JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION: 'true',
            JSII_SILENCE_WARNING_KNOWN_BROKEN_NODE_VERSION: 'true',
            DOCKERHUB_DISABLED: 'true',
            AWS_REGIONS: ['us-east-2', 'eu-west-1', 'eu-north-1', 'ap-northeast-1', 'ap-south-1'].join(','),
            CDK_MAJOR_VERSION: '2',
            RELEASE_TAG: 'latest',
            GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
          },
        },
      ],
    });
  }
}
