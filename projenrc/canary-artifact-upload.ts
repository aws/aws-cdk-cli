import { Component, github } from 'projen';
import { JobPermission } from 'projen/lib/github/workflows-model';
import type { TypeScriptProject } from 'projen/lib/typescript';

export interface CanaryArtifactUploadProps {
  /**
   * The workspace directory of the `aws-cdk` CLI package, relative to the repo
   * root (e.g. `packages/aws-cdk`). The packed tarball is expected at
   * `<cliWorkspaceDirectory>/dist/js/*.tgz`.
   */
  readonly cliWorkspaceDirectory: string;

  /**
   * The nx package name of the CLI to build/pack (e.g. `aws-cdk`).
   */
  readonly cliPackageName: string;

  /**
   * The name (or GitHub expression) of the shared S3 bucket in the cdk-ops /
   * canary account to upload the CLI tarball to.
   *
   * The bucket is owned by cdk-ops (its `CanaryArtifacts` bucket) and grants
   * the repo OIDC role write access to the `cli/*` prefix.
   */
  readonly bucketName: string;

  /**
   * The role (or GitHub expression) to assume via OIDC for the upload. This is
   * the repo's existing release role, which cdk-ops grants S3 write on `cli/*`.
   */
  readonly roleToAssume: string;

  /**
   * Only run the upload on these repositories. Prevents forks from attempting
   * to authenticate and upload.
   */
  readonly restrictToRepos: string[];

  /**
   * AWS region to authenticate against.
   *
   * @default 'us-east-1'
   */
  readonly awsRegion?: string;
}

/**
 * Emits the CLI artifact consumed by the cdk-ops daily Windows canary.
 *
 * On every push to `main`, this builds + packs the `aws-cdk` CLI and uploads,
 * to a shared S3 bucket in the cdk-ops account:
 *
 *   - `cli/<sha>.tgz`     -- the packed npm tarball for the built commit
 *   - `cli/latest.json`   -- `{ sha, cliVersion, builtAt }` pointer object
 *
 * The cdk-ops canary reads `cli/latest.json`, downloads `cli/<sha>.tgz`, and
 * runs `run-suite --cli-version=<tarball> --framework-version=latest
 * cli-integ-tests` on Windows. The tarball MUST be the real `npm pack` output
 * for `aws-cdk` (installable from a path), which is what the build produces at
 * `<cliWorkspaceDirectory>/dist/js/*.tgz`.
 *
 * This is NOT a release gate -- it does not block anything and does not wait on
 * tests. It only emits the artifact for continuous daily monitoring of `main`.
 */
export class CanaryArtifactUpload extends Component {
  public readonly workflow: github.GithubWorkflow;

  constructor(repo: TypeScriptProject, props: CanaryArtifactUploadProps) {
    super(repo);

    if (!repo.github) {
      throw new Error('Given repository does not have a GitHub component');
    }

    const awsRegion = props.awsRegion ?? 'us-east-1';
    const roleSessionName = 'cli-canary-upload@aws-cdk-cli';

    this.workflow = repo.github.addWorkflow('cli-canary-artifact');
    this.workflow.on({
      push: { branches: ['main'] },
      // Allow manual re-emission of the artifact for the current main.
      workflowDispatch: {},
    });

    this.workflow.addJob('upload', {
      name: 'Build and upload CLI tarball for the Windows canary',
      runsOn: ['ubuntu-latest'],
      permissions: {
        contents: JobPermission.READ,
        idToken: JobPermission.WRITE,
      },
      if: props.restrictToRepos.map(r => `github.repository == '${r}'`).join(' || '),
      steps: [
        github.WorkflowSteps.checkout(),
        ...repo.renderWorkflowSetup(),
        {
          name: 'Build and pack the CLI',
          // The `package` target produces the installable npm tarball at
          // packages/aws-cdk/dist/js/*.tgz (same output as `npm pack`).
          run: `yarn nx run ${props.cliPackageName}:package`,
        },
        {
          name: 'Resolve the packed tarball',
          id: 'tarball',
          run: [
            `TARBALL="$(ls ${props.cliWorkspaceDirectory}/dist/js/*.tgz)"`,
            'COUNT="$(echo "$TARBALL" | wc -l | tr -d " ")"',
            'if [ "$COUNT" != "1" ] || [ -z "$TARBALL" ]; then',
            '  echo "::error::Expected exactly one CLI tarball, found: $TARBALL"',
            '  exit 1',
            'fi',
            'echo "path=$TARBALL" >> "$GITHUB_OUTPUT"',
            `echo "version=$(node -p "require('./${props.cliWorkspaceDirectory}/package.json').version")" >> "$GITHUB_OUTPUT"`,
          ].join('\n'),
        },
        {
          name: 'Authenticate Via OIDC Role',
          id: 'creds',
          uses: 'aws-actions/configure-aws-credentials@v6',
          with: {
            'aws-region': awsRegion,
            'role-to-assume': props.roleToAssume,
            'role-session-name': roleSessionName,
            'mask-aws-account-id': true,
          },
        },
        {
          name: 'Upload CLI tarball and latest pointer',
          env: {
            BUCKET_NAME: props.bucketName,
            TARBALL_PATH: '${{ steps.tarball.outputs.path }}',
            CLI_VERSION: '${{ steps.tarball.outputs.version }}',
          },
          run: [
            'echo "::add-mask::$BUCKET_NAME"',
            // Full commit SHA of the merged main state being built.
            'SHA="$GITHUB_SHA"',
            'BUILT_AT="$(date +%s)"',
            '',
            'echo "Uploading CLI tarball to s3://$BUCKET_NAME/cli/$SHA.tgz"',
            'aws s3 cp "$TARBALL_PATH" "s3://$BUCKET_NAME/cli/$SHA.tgz"',
            '',
            // Build the pointer object the canary reads to find the tarball.
            'printf \'{"sha":"%s","cliVersion":"%s","builtAt":%s}\\n\' \\',
            '  "$SHA" "$CLI_VERSION" "$BUILT_AT" > latest.json',
            'echo "latest.json contents:"',
            'cat latest.json',
            'aws s3 cp latest.json "s3://$BUCKET_NAME/cli/latest.json" --content-type application/json',
          ].join('\n'),
        },
      ],
    });
  }
}
