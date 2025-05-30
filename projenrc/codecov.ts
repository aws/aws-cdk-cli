import { Component, github } from 'projen';
import { JobPermission } from 'projen/lib/github/workflows-model';
import type { TypeScriptProject } from 'projen/lib/typescript';

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
      runsOn: ['aws-cdk_ubuntu-latest_4-core'],
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
          name: 'Reset coverage thresholds',
          run: 'find . -name "jest.config.json" -type f -exec chmod +w {} \\; -exec node -e "const fs=require(\'fs\'); const file=process.argv[1]; const data=JSON.parse(fs.readFileSync(file)); data.coverageThreshold={ }; fs.writeFileSync(file, JSON.stringify(data, null, 2));" {} \\;',
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
            disable_search: true,
            files: props.packages.map(p => `packages/${p}/coverage/cobertura-coverage.xml`).join(','),
            fail_ci_if_error: true,
            flags: 'suite.unit',
            use_oidc: true,
          },
        },
      ],
    });
  }
}
