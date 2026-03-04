import type { Project } from 'projen';
import { JsonPatch, github } from 'projen';

/**
 * Options for configuring self-mutation behavior on forks
 */
export interface SelfMutationOnForksOptions {
  /**
   * Environment name to use for the workflow
   * @default - no environment specified
   */
  readonly environment?: string;
}

/**
 * Configures GitHub workflows to enable self-mutation on fork pull requests.
 *
 * This class sets up a workflow that will automatically apply projen-generated changes
 * when a build fails due to outdated generated files. The workflow:
 *
 * 1. Runs when the build workflow fails on a PR
 * 2. Downloads any patch file generated during the failed build
 * 3. Authenticates using GitHub App credentials
 * 4. Checks out the PR branch
 * 5. Applies the patch if it exists and can be applied cleanly
 * 6. Commits and pushes the changes back to the PR
 *
 * This enables automated fixes for common projen-related issues on fork PRs.
 */
export class SelfMutationOnForks {
  constructor(project: Project, options: SelfMutationOnForksOptions = {}) {
    const cicd = github.GitHub.of(project);
    if (!cicd) return;

    const buildWorkflow = cicd.tryFindWorkflow('build');
    if (!buildWorkflow) return;

    // Update condition to run on all pull requests
    buildWorkflow.file?.patch(
      JsonPatch.remove('/jobs/self-mutation'),
    );

    // Add a new self mutation workflow that runs on completion of build
    // and if the build failed and there is a patch, updates the PR
    const selfMutation = cicd?.addWorkflow('self-mutation');
    selfMutation?.on({
      workflowRun: {
        workflows: [buildWorkflow.name],
        types: ['completed'],
      },
    });

    selfMutation?.addJob('self-mutation', {
      runsOn: ['ubuntu-latest'],
      if: "github.event.workflow_run.conclusion == 'failure' && github.event.workflow_run.event == 'pull_request'",
      permissions: {
        contents: github.workflows.JobPermission.READ,
      },
      environment: options.environment,
      steps: [
        {
          name: 'Download patch',
          id: 'download_patch',
          continueOnError: true,
          uses: 'dawidd6/action-download-artifact@ac66b43f0e6a346234dd65d4d0c8fbb31cb316e5',
          with: {
            run_id: '${{ github.event.workflow_run.id }}',
            name: 'repo.patch',
            path: '${{ runner.temp }}',
          },
        },
        ...conditionalSteps(
          'steps.download_patch.outcome == \'success\'',
          cicd.projenCredentials.setupSteps,
          github.WorkflowSteps.checkout({
            name: 'Checkout PR',
            with: {
              repository: '${{ github.event.workflow_run.head_repository.full_name }}',
              ref: '${{ github.event.workflow_run.head_branch }}',
              token: cicd.projenCredentials.tokenRef,
            },
          }),
          {
            name: 'Apply patch to PR',
            run: [
              'set -e',
              'if [ ! -f "${{ runner.temp }}/repo.patch" ]; then',
              '  echo "Patch file not found"',
              '  exit 1',
              'fi',
              'git config user.name "github-actions[bot]"',
              'git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
              'if ! git apply --check ${{ runner.temp }}/repo.patch; then',
              '  echo "Patch cannot be applied cleanly"',
              '  exit 1',
              'fi',
              'git apply ${{ runner.temp }}/repo.patch',
              'if [ -z "$(git status --porcelain)" ]; then',
              '  echo "No changes to commit"',
              '  exit 0',
              'fi',
              'git add .',
              'git commit -s -m "chore: self mutation"',
              'git push',
            ].join('\n'),
          },
        ),
      ],
    });
  }
}

function conditionalSteps(cond: string, ...steps: Array<github.workflows.JobStep | github.workflows.JobStep[]>): github.workflows.JobStep[] {
  return steps.flatMap(s => s).map(s => ({ ...s, if: s.if ?? cond }));
}
