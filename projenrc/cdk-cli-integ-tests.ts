import { yarn } from 'cdklabs-projen-project-types';
import type { javascript, Project } from 'projen';
import { Component, github, TextFile } from 'projen';

const NOT_FLAGGED_EXPR = "!contains(github.event.pull_request.labels.*.name, 'pr/exempt-integ-test')";

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
  constructor(repo: javascript.NodeProject, props: CdkCliIntegTestsWorkflowProps) {
    super(repo);

    const buildWorkflow = repo.buildWorkflow;
    const runTestsWorkflow = repo.github?.addWorkflow('integ');
    if (!buildWorkflow || !runTestsWorkflow) {
      throw new Error('Expected build and run tests workflow');
    }
    ((buildWorkflow as any).workflow as github.GithubWorkflow);

    const localPackages = repo.subprojects
      .filter(p => p instanceof yarn.TypeScriptWorkspace && !p.isPrivatePackage)
      .map(p => p.name);
    const upstreamVersions = (props.allowUpstreamVersions ?? [])?.map(p => p.name);
    upstreamVersions.forEach((pack) => {
      if (!localPackages.includes(pack)) {
        throw new Error(`Package in allowUpstreamVersions is not a local monorepo package: ${pack}`);
      }
    });

    let maxWorkersArg = '';
    if (props.maxWorkers) {
      maxWorkersArg = ` --maxWorkers=${props.maxWorkers}`;
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

    runTestsWorkflow.on({
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
    const JOB_PREPARE = 'prepare';
    runTestsWorkflow.addJob(JOB_PREPARE, {
      environment: props.approvalEnvironment,
      runsOn: [props.buildRunsOn],
      permissions: {
        contents: github.workflows.JobPermission.READ,
      },
      env: {
        CI: 'true',
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
            `git remote add upstream https://github.com/${props.sourceRepo}.git`,
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
            name: 'script-artifact',
            path: '.projen/*.sh',
            overwrite: 'true',
          },
        },
      ],
    });

    // We create a matrix job for the test.
    // This job will run all the different test suites in parallel.
    const matrixInclude: github.workflows.JobMatrix['include'] = [];
    const matrixExclude: github.workflows.JobMatrix['exclude'] = [];

    // In addition to the default runs, run these suites under different Node versions
    matrixInclude.push(...['init-typescript-app', 'toolkit-lib-integ-tests'].flatMap(
      suite => (props.additionalNodeVersionsToTest ?? []).map(node => ({ suite, node }))));

    // We are finding that Amplify works on Node 20, but fails on Node >=22.10. Remove the 'lts/*' test and use a Node 20 for now.
    matrixExclude.push({ suite: 'tool-integrations', node: 'lts/*' });
    matrixInclude.push({ suite: 'tool-integrations', node: 20 });

    const JOB_INTEG_MATRIX = 'integ_matrix';
    runTestsWorkflow.addJob(JOB_INTEG_MATRIX, {
      environment: props.testEnvironment,
      runsOn: [props.testRunsOn],
      needs: [JOB_PREPARE],
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
        // This is necessary because the new versioning of @aws-cdk/cli-lib-alpha
        // matches the CLI and not the framework.
        CLI_LIB_VERSION_MIRRORS_CLI: 'true',
      },
      // Don't run again on the merge queue, we already got confirmation that it works and the
      // tests are quite expensive.
      if: `github.event_name != 'merge_group' && ${NOT_FLAGGED_EXPR}`,
      strategy: {
        failFast: false,
        matrix: {
          domain: {
            suite: [
              'cli-integ-tests',
              'toolkit-lib-integ-tests',
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
            node: ['lts/*'],
          },
          include: matrixInclude,
          exclude: matrixExclude,
        },
      },
      steps: [
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
        {
          name: 'Setup Node.js',
          uses: 'actions/setup-node@v4',
          with: {
            'node-version': '${{ matrix.node }}',
          },
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
          name: 'Authenticate Via OIDC Role',
          id: 'creds',
          uses: 'aws-actions/configure-aws-credentials@v4',
          with: {
            'aws-region': 'us-east-1',
            'role-duration-seconds': props.enableAtmosphere ? 60 * 60 : 4 * 60 * 60,
            // Expect this in Environment Variables
            'role-to-assume': props.enableAtmosphere ? props.enableAtmosphere.oidcRoleArn : '${{ vars.AWS_ROLE_TO_ASSUME_FOR_TESTING }}',
            'role-session-name': 'run-tests@aws-cdk-cli-integ',
            'output-credentials': true,
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
          name: 'Prepare Verdaccio',
          run: '.projen/prepare-verdaccio.sh',
        },
        {
          name: 'Download and install the test artifact',
          run: [
            'npm install @aws-cdk-testing/cli-integ',
          ].join('\n'),
        },
        {
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
        },
        {
          name: 'Run the test suite: ${{ matrix.suite }}',
          run: [
            `npx run-suite${maxWorkersArg} --use-cli-release=\${{ steps.versions.outputs.cli_version }} --framework-version=\${{ steps.versions.outputs.lib_version }} \${{ matrix.suite }}`,
          ].join('\n'),
          env: {
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
          },
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
        {
          name: 'Upload logs',
          if: 'always()',
          uses: 'actions/upload-artifact@v4.4.0',
          id: 'logupload',
          with: {
            name: 'logs-${{ matrix.suite }}-${{ matrix.node }}',
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

    // Add a job that collates all matrix jobs into a single status
    // This is required so that we can setup required status checks
    // and if we ever change the test matrix, we don't need to update
    // the status check configuration.
    runTestsWorkflow.addJob('integ', {
      permissions: {},
      runsOn: [props.testRunsOn],
      needs: [JOB_PREPARE, JOB_INTEG_MATRIX],
      if: 'always()',
      steps: [
        {
          name: 'Integ test result',
          run: `echo \${{ needs.${JOB_INTEG_MATRIX}.result }}`,
        },
        {
          // Don't fail the job if the test was successful or intentionally skipped
          if: `\${{ !(contains(fromJSON('["success", "skipped"]'), needs.${JOB_PREPARE}.result) && contains(fromJSON('["success", "skipped"]'), needs.${JOB_INTEG_MATRIX}.result)) }}`,
          name: 'Set status based on matrix job',
          run: 'exit 1',
        },
      ],
    });
  }
}
