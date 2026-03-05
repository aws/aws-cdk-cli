import { Component } from 'projen';
import { JobPermission } from 'projen/lib/github/workflows-model';
import type { TypeScriptProject } from 'projen/lib/typescript';

export class IssueRegressionLabeler extends Component {
  constructor(repo: TypeScriptProject) {
    super(repo);

    if (!repo.github) {
      throw new Error('IssueRegressionLabeler requires a GitHub project');
    }

    const workflow = repo.github.addWorkflow('issue-regression-labeler');
    workflow.on({
      issues: {
        types: ['opened', 'edited'],
      },
    });

    workflow.addJob('add-regression-label', {
      name: 'Manage regression label',
      runsOn: ['ubuntu-latest'],
      permissions: {
        issues: JobPermission.WRITE,
      },
      steps: [
        {
          name: 'Fetch template body',
          id: 'check_regression',
          uses: 'actions/github-script@v8',
          env: {
            GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
            TEMPLATE_BODY: '${{ github.event.issue.body }}',
          },
          with: {
            script: `const regressionPattern = /\\[x\\] Select this option if this issue appears to be a regression\\./i;
          const template = \`\${process.env.TEMPLATE_BODY}\`
          const match = regressionPattern.test(template);
          core.setOutput('is_regression', match);`,
          },
        },
        {
          name: 'Manage regression label',
          env: {
            GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
          },
          run: `if [ "\${{ steps.check_regression.outputs.is_regression }}" == "true" ]; then
          gh issue edit \${{ github.event.issue.number }} --add-label "potential-regression" -R \${{ github.repository }}
        else
          gh issue edit \${{ github.event.issue.number }} --remove-label "potential-regression" -R \${{ github.repository }}
        fi`,
        },
      ],
    });
  }
}
