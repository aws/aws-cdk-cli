import type { Monorepo, TypeScriptWorkspace } from 'cdklabs-projen-project-types/lib/yarn';
import { Component, github } from 'projen';

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

    const safeName = this.project.name.replace('@', '').replace('/', '-');

    releaseWf.addJob(`${safeName}_release_docs`, {
      name: `${this.project.name}: Publish docs to S3`,
      environment: 'releasing', // <-- this has the configuration
      needs: [`${safeName}_release_npm`],
      runsOn: ['ubuntu-latest'],
      permissions: {
        idToken: github.workflows.JobPermission.WRITE,
        contents: github.workflows.JobPermission.READ,
      },
      steps: [
        {
          name: 'Download build artifacts',
          uses: 'actions/download-artifact@v4',
          with: {
            name: `${safeName}_build-artifact`,
            path: 'dist',
          },
        },
        {
          name: 'Authenticate Via OIDC Role',
          id: 'creds',
          uses: 'aws-actions/configure-aws-credentials@v4',
          with: {
            'aws-region': 'us-east-1',
            'role-to-assume': '${{ vars.AWS_ROLE_TO_ASSUME_FOR_ACCOUNT }}',
            'role-session-name': 's3-docs-publishing@aws-cdk-cli',
            'mask-aws-account-id': true,
          },
        },
        {
          name: 'Assume the publishing role',
          id: 'publishing-creds',
          uses: 'aws-actions/configure-aws-credentials@v4',
          with: {
            'aws-region': 'us-east-1',
            'role-to-assume': this.props.roleToAssume,
            'role-session-name': 's3-docs-publishing@aws-cdk-cli',
            'mask-aws-account-id': true,
            'role-chaining': true,
          },
        },
        {
          name: 'Publish docs',
          env: {
            BUCKET_NAME: this.props.bucketName,
            DOCS_STREAM: this.props.docsStream,
          },
          run: [
            'echo ::add-mask::$BUCKET_NAME', // always hide bucket name

            // setup paths
            `echo "S3_PATH=$DOCS_STREAM/${safeName}-v$(cat dist/version.txt).zip" >> "$GITHUB_ENV"`,
            'echo "S3_URI=s3://$BUCKET_NAME/$S3_PATH" >> "$GITHUB_ENV"',
            `echo "LATEST=latest-${this.props.docsStream}" >> "$GITHUB_ENV"`,

            // create the latest marker
            'echo "$S3_PATH" > "$LATEST"',

            // check if the target file already exists and upload
            '(! aws s3 ls --human-readable $S3_URI \\',
            `&& aws s3 cp --dryrun dist/${this.props.artifactPath} $S3_URI \\`,
            '&& aws s3 cp --dryrun $LATEST s3://$BUCKET_NAME/$LATEST) \\',
            '|| (echo "Docs artifact already published, skipping upload")',
          ].join('\n'),
        },
      ],
    });
  }
}
