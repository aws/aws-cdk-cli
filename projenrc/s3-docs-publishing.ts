import type { Monorepo, TypeScriptWorkspace } from 'cdklabs-projen-project-types/lib/yarn';
import { Component, github } from 'projen';
import { runAfterPublish } from './util';

export interface S3DocsPublishingProps {
  /**
   * The docs stream to publish to.
   */
  readonly docsStream: string;

  /**
   * The path to the artifact in the dist folder
   */
  readonly artifactPath: string;

  /**
   * The role arn (or github expression) for OIDC to assume to do the actual publishing.
   */
  readonly roleToAssume: string;

  /**
   * The bucket name (or github expression) to publish to.
   */
  readonly bucketName: string;

  /**
   * The path prefix for the versioned docs artifacts
   *
   * @example "foobar" -> "foobar-v1.2.3.zip"
   * @default - sanitized package name
   */
  readonly s3PathPrefix?: string;
}

export class S3DocsPublishing extends Component {
  private readonly github: github.GitHub;
  private readonly props: S3DocsPublishingProps;

  constructor(project: TypeScriptWorkspace, props: S3DocsPublishingProps) {
    super(project);

    const gh = (project.parent! as Monorepo).github;
    if (!gh) {
      throw new Error('This workspace does not have a GitHub instance');
    }
    this.github = gh;

    this.props = props;
  }

  public preSynthesize() {
    const releaseWf = this.github.tryFindWorkflow('release');
    if (!releaseWf) {
      throw new Error('Could not find release workflow');
    }

    // Declare variables used for naming various things
    const niceName = `${this.project.name} ${this.props.docsStream}`;
    const safePackageName = this.project.name.replace('@', '').replace('/', '-');
    const docsStreamId= `${safePackageName}-${this.props.docsStream.toLowerCase()}`;
    const s3PathPrefix = this.props.s3PathPrefix ? `${this.props.s3PathPrefix}-v` : `${safePackageName}-v`;

    releaseWf.addJob(`${safePackageName}_release_docs_${this.props.docsStream}`, {
      name: `${this.project.name}: Publish docs ${niceName} to S3`,
      environment: 'releasing', // <-- this has the configuration
      needs: [`${safePackageName}_release_npm`],
      runsOn: ['ubuntu-latest'],
      if: runAfterPublish(`${safePackageName}_release_npm`),
      permissions: {
        idToken: github.workflows.JobPermission.WRITE,
        contents: github.workflows.JobPermission.READ,
      },
      steps: [
        github.WorkflowSteps.downloadArtifact({
          with: {
            name: `${safePackageName}_build-artifact`,
            path: 'dist',
          },
        }),
        {
          name: 'Authenticate Via OIDC Role',
          id: 'creds',
          uses: 'aws-actions/configure-aws-credentials@v6',
          with: {
            'aws-region': 'us-east-1',
            'role-to-assume': '${{ vars.AWS_ROLE_TO_ASSUME_FOR_ACCOUNT }}',
            'role-session-name': `s3-${docsStreamId}-docs-publishing@aws-cdk-cli`,
            'mask-aws-account-id': true,
          },
        },
        {
          name: 'Assume the publishing role',
          id: 'publishing-creds',
          uses: 'aws-actions/configure-aws-credentials@v6',
          with: {
            'aws-region': 'us-east-1',
            'role-to-assume': this.props.roleToAssume,
            'role-session-name': `s3-${docsStreamId}-docs-publishing@aws-cdk-cli`,
            'mask-aws-account-id': true,
            'role-chaining': true,
          },
        },
        {
          name: `Publish docs ${this.project.name} ${this.props.docsStream}`,
          env: {
            BUCKET_NAME: this.props.bucketName,
            DOCS_STREAM: this.props.docsStream,
          },
          run: `echo "Uploading ${docsStreamId} to S3"
echo "::add-mask::$BUCKET_NAME"
S3_PATH="$DOCS_STREAM/${s3PathPrefix}$(cat dist/version.txt).zip"
LATEST="latest-${this.props.docsStream}"

# Capture both stdout and stderr
if OUTPUT=$(aws s3api put-object \\
  --bucket "$BUCKET_NAME" \\
  --key "$S3_PATH" \\
  --body dist/${this.props.artifactPath} \\
  --if-none-match "*" 2>&1); then
  
  # File was uploaded successfully, update the latest pointer
  echo "New ${docsStreamId} artifact uploaded successfully, updating latest pointer"
  echo "$S3_PATH" | aws s3 cp - "s3://$BUCKET_NAME/$LATEST"

elif echo "$OUTPUT" | grep -q "PreconditionFailed"; then
  # Check specifically for PreconditionFailed in the error output
  echo "::warning::File already exists in S3. Skipping upload."
  exit 0

else
  # Any other error (permissions, etc)
  echo "::error::Failed to upload ${docsStreamId} artifact"
  exit 1
fi`,
        },
      ],
    });
  }
}
