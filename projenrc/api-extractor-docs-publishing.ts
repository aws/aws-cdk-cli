import type { Monorepo, TypeScriptWorkspace } from 'cdklabs-projen-project-types/lib/yarn';
import { Component, github } from 'projen';

export interface ApiExtractorDocsPublishingProps {
  /**
   * The docs stream to publish to.
   */
  readonly docsStream: string;

  /**
   * The role arn (or github expression) for OIDC to assume to do the actual publishing.
   */
  readonly roleToAssume: string;

  /**
   * The bucket name (or github expression) to publish to.
   */
  readonly bucketName: string;
}

export class ApiExtractorDocsPublishing extends Component {
  private readonly github: github.GitHub;
  private readonly props: ApiExtractorDocsPublishingProps;

  constructor(project: TypeScriptWorkspace, props: ApiExtractorDocsPublishingProps) {
    super(project);

    const gh = (project.parent! as Monorepo).github;
    if (!gh) {
      throw new Error('This workspace does not have a GitHub instance');
    }
    this.github = gh;

    this.props = props;

    // Add a task to run api-extractor and zip the output
    const apiExtractorDocsTask = project.addTask('api-extractor-docs', {
      exec: [
        // Run api-extractor to generate the API model
        // Use || true to ensure the task continues even if api-extractor reports failures
        'api-extractor run --local || true',
        // Create a directory for the API model
        'mkdir -p dist/api-extractor-docs/cdk/api/toolkit-lib',
        // Copy the API model to the directory
        'cp dist/*.api.json dist/api-extractor-docs/cdk/api/toolkit-lib/',
        // Add version file
        '(cat dist/version.txt || echo "latest") > dist/api-extractor-docs/cdk/api/toolkit-lib/VERSION',
        // Find and copy all markdown files (excluding node_modules)
        'find . -type f -name "*.md" -not -path "*/node_modules/*" -not -path "*/dist/*" | while read file; do ' +
        'mkdir -p "dist/api-extractor-docs/cdk/api/toolkit-lib/$(dirname "$file")" && ' +
        'cp "$file" "dist/api-extractor-docs/cdk/api/toolkit-lib/$file"; ' +
        'done',
        // Zip the API model and markdown files
        'cd dist/api-extractor-docs && zip -r ../api-extractor-docs.zip cdk',
      ].join(' && '),
    });

    // Add the api-extractor-docs task to the package task
    project.packageTask.spawn(apiExtractorDocsTask);
  }

  public preSynthesize() {
    const releaseWf = this.github.tryFindWorkflow('release');
    if (!releaseWf) {
      throw new Error('Could not find release workflow');
    }

    const safeName = this.project.name.replace('@', '').replace('/', '-');

    releaseWf.addJob(`${safeName}_release_api_extractor_docs`, {
      name: `${this.project.name}: Publish API Extractor docs to S3`,
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
            'role-session-name': 's3-api-extractor-docs-publishing@aws-cdk-cli',
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
            'role-session-name': 's3-api-extractor-docs-publishing@aws-cdk-cli',
            'mask-aws-account-id': true,
            'role-chaining': true,
          },
        },
        {
          name: 'Publish API Extractor docs',
          env: {
            BUCKET_NAME: this.props.bucketName,
            DOCS_STREAM: this.props.docsStream,
          },
          run: `echo "Uploading API Extractor docs to S3"
            echo "::add-mask::$BUCKET_NAME"
            S3_PATH="$DOCS_STREAM/${safeName}-api-model-v$(cat dist/version.txt).zip"
            LATEST="latest-api-model-${this.props.docsStream}"

            # Capture both stdout and stderr
            if OUTPUT=$(aws s3api put-object \\
              --bucket "$BUCKET_NAME" \\
              --key "$S3_PATH" \\
              --body dist/api-extractor-docs.zip \\
              --if-none-match "*" 2>&1); then
              
              # File was uploaded successfully, update the latest pointer
              echo "New API Extractor docs artifact uploaded successfully, updating latest pointer"
              echo "$S3_PATH" | aws s3 cp - "s3://$BUCKET_NAME/$LATEST"

            elif echo "$OUTPUT" | grep -q "PreconditionFailed"; then
              # Check specifically for PreconditionFailed in the error output
              echo "::warning::File already exists in S3. Skipping upload."
              exit 0

            else
              # Any other error (permissions, etc)
              echo "::error::Failed to upload API Extractor docs artifact"
              exit 1
            fi`,
        },
      ],
    });
  }
}
