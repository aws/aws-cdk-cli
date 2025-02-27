import { Monorepo } from 'cdklabs-projen-project-types/lib/yarn';
import { Component, github } from 'projen';
import { JobPermission } from 'projen/lib/github/workflows-model';

export class AdcPublishing extends Component {
  constructor(private readonly project_: Monorepo) {
    super(project_);
  }

  public preSynthesize() {
    for (const taskName of ['build', 'release']) {
      this.project.tasks.tryFind(taskName)?.exec('tsx projenrc/build-standalone-zip.task.ts');
    }

    const releaseWf = this.project_.github?.tryFindWorkflow('release');
    if (!releaseWf) {
      throw new Error('Could not find release workflow');
    }

    (releaseWf.getJob('release') as github.workflows.Job).steps.push({
      name: 'standalone: Upload artifact',
      if: '${{ steps.git_remote.outputs.latest_commit == github.sha }}',
      uses: 'actions/upload-artifact@v4.4.0',
      with: {
        name: 'standalone_build-artifact',
        path: 'dist/standalone',
        overwrite: true,
      },
    });

    releaseWf.addJob('standalone_release_adc', {
      name: 'standalone: publish to ADC',
      environment: 'releasing', // <-- this has the configuration
      needs: ['release'],
      runsOn: ['ubuntu-latest'],
      permissions: {
        contents: JobPermission.WRITE,
        idToken: JobPermission.WRITE,
      },
      if: '${{ needs.release.outputs.latest_commit == github.sha }}',
      steps: [
        github.WorkflowSteps.checkout(),
        {
          uses: 'actions/setup-node@v4',
          with: {
            'node-version': 'lts/*',
          },
        },
        {
          name: 'Download build artifacts',
          uses: 'actions/download-artifact@v4',
          with: {
            name: 'standalone_build-artifact',
            path: 'dist/standalone',
          },
        },
        {
          name: 'Authenticate Via OIDC Role',
          id: 'creds',
          uses: 'aws-actions/configure-aws-credentials@v4',
          with: {
            'aws-region': 'us-east-1',
            'role-to-assume': '${{ vars.AWS_ROLE_TO_ASSUME_FOR_ACCOUNT }}',
            'role-session-name': 'standalone-release@aws-cdk-cli',
            'output-credentials': true,
            'mask-aws-account-id': true,
          },
        },
        {
          name: 'Publish artifacts',
          env: {
            PUBLISHING_ROLE_ARN: '${{ vars.PUBLISHING_ROLE_ARN }}',
            TARGET_BUCKETS: '${{ vars.TARGET_BUCKETS }}',
          },
          run: 'npx tsx projenrc/publish-to-adc.task.ts',
        },
      ],
    });
  }
}
