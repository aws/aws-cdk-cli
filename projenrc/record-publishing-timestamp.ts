import { Monorepo } from 'cdklabs-projen-project-types/lib/yarn';
import { Component } from 'projen';
import { JobPermission } from 'projen/lib/github/workflows-model';

/**
 * Record publishing timestamp to SSM
 */
export class RecordPublishingTimestamp extends Component {
  constructor(private readonly project_: Monorepo) {
    super(project_);
  }

  public preSynthesize() {
    const ssmPrefix = '/published/cdk/cli-npm';

    const releaseWf = this.project_.github?.tryFindWorkflow('release');
    if (!releaseWf) {
      throw new Error('Could not find release workflow');
    }

    releaseWf.addJob('record_timestamp', {
      name: 'aws-cdk: Record publishing timestamp',
      environment: 'releasing', // <-- this has the configuration
      needs: ['release'],
      runsOn: ['ubuntu-latest'],
      permissions: {
        contents: JobPermission.WRITE,
        idToken: JobPermission.WRITE,
      },
      if: '${{ needs.release.outputs.latest_commit == github.sha }}',
      steps: [
        {
          name: 'Download build artifacts',
          uses: 'actions/download-artifact@v4',
          with: {
            name: 'aws-cdk_build-artifact',
            path: 'dist',
          },
        },
        {
          name: 'Read version from build artifacts',
          id: 'aws-cdk-version',
          run: 'echo "version=$(cat dist/version.txt)" >> $GITHUB_OUTPUT',
        },
        {
          name: 'Authenticate Via OIDC Role',
          id: 'creds',
          uses: 'aws-actions/configure-aws-credentials@v4',
          with: {
            'aws-region': 'us-east-1',
            'role-to-assume': '${{ vars.AWS_ROLE_TO_ASSUME_FOR_ACCOUNT }}',
            'role-session-name': 'publish-timestamps@aws-cdk-cli',
            'mask-aws-account-id': true,
          },
        },
        {
          name: 'Publish artifacts',
          run: [
            `aws ssm put-parameter --name "${ssmPrefix}/version" --type "String" --value "\${{ steps.aws-cdk-version.outputs.version }}" --overwrite`,
            `aws ssm put-parameter --name "${ssmPrefix}/timestamp" --type "String" --value "$(date +%s)" --overwrite`,
          ].join('\n'),
        },
      ],
    });
  }
}

