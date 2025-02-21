import { Component, github } from "projen";
import { JobPermission } from "projen/lib/github/workflows-model";
import { TypeScriptProject } from "projen/lib/typescript";

export interface CodeCovWorkflowProps {
  readonly restrictToRepos: string[];
  readonly packages: string[];
}

export class CodeCovWorkflow extends Component {
  public readonly workflow: github.GithubWorkflow;

  constructor(repo: TypeScriptProject, props: CodeCovWorkflowProps) {
    super(repo);

    if (!repo.github) {
      throw new Error('Given repository does not have a GitHub component');
    }

    this.workflow = repo.github.addWorkflow('codecov');
    this.workflow.on({
      push: { branches: ['main'] },
      pullRequest: { branches: ['main'] },
    });

    this.workflow.addJob('collect', {
      runsOn: ['ubuntu-latest'],
      permissions: { idToken: JobPermission.WRITE },
      if: props.restrictToRepos.map(r => `github.repository == '${r}'`).join(' || '),
      steps: [
        github.WorkflowSteps.checkout(),
        {
          name: 'Set up Node',
          uses: 'actions/setup-node@v4',
          with: {
            'node-version': 'lts/*',
          },
        },
        {
          name: 'Install dependencies',
          run: 'yarn install',
        },
        {
          name: 'Build and test CLI',
          // The 'build' job includes running tests
          run: `yarn nx run ${props.packages.map(p => `${p}:build`).join(' ')}`,
        },
        {
          name: 'Upload results to Codecov',
          uses: 'codecov/codecov-action@v5',
          with: {
            files: props.packages.map(p => `packages/${p}/coverage/cobertura-coverage.xml`).join(','),
            fail_ci_if_error: true,
            flags: 'suite.unit',
            use_oidc: true
          },
        },
      ],
    });
  }
}