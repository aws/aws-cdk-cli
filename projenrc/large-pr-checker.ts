import { github, Component } from 'projen';
import { JobPermission } from 'projen/lib/github/workflows-model';
import type { TypeScriptProject } from 'projen/lib/typescript';

export interface LargePrCheckerProps {
  /**
   * The number of lines changed in the PR that will trigger a comment and a failure.
   *
   * @default 1000
   */
  readonly maxLinesChanged?: number;

  /**
   * A list of files to exclude from the line count.
   *
   * @default - none
   */
  readonly excludeFiles?: string[];
}

export class LargePrChecker extends Component {
  private readonly workflow: github.GithubWorkflow;

  constructor(repo: TypeScriptProject, props: LargePrCheckerProps = {}) {
    super(repo);

    if (!repo.github) {
      throw new Error('Given repository does not have a GitHub component');
    }

    const maxLinesChanged = props.maxLinesChanged ?? 1000;
    const excludeFiles = (props.excludeFiles ?? [])
      .map((pattern) => `':(exclude)${pattern}'`)
      .join(' ');

    this.workflow = repo.github.addWorkflow('large-pr-checker');
    this.workflow.on({
      pullRequest: {
        branches: ['main'],
        types: ['labeled', 'edited', 'opened', 'reopened', 'unlabeled'],
      },
    });

    this.workflow.addJob('check', {
      name: 'Check PR size',
      if: '${{ !contains(github.event.pull_request.labels.*.name, \'pr/exempt-size-check\') }}',
      runsOn: ['ubuntu-latest'],
      permissions: {
        pullRequests: JobPermission.WRITE,
      },
      steps: [
        github.WorkflowSteps.checkout(),
        {
          id: 'fetch_target_branch',
          run: 'git fetch origin main',
        },
        {
          id: 'get_total_lines_changed',
          run: `size=$(git diff --shortstat origin/main ${excludeFiles} \\
        | awk '{ print $4+$6 }' \\
        | awk -F- '{print $NF}' \\
        | bc)
        
        size=\${size:-0}
        
        echo "Total lines changed: $size"
        echo "total_lines_changed=$size" >> $GITHUB_OUTPUT`,
        },
        {
          id: 'comment_pr',
          if: `$\{{ fromJSON(steps.get_total_lines_changed.outputs.total_lines_changed) > fromJSON(${maxLinesChanged}) }}`,
          uses: 'thollander/actions-comment-pull-request@v2',
          with: {
            comment_tag: 'pr_size',
            mode: 'recreate',
            message: `Total lines changed $\{{ steps.get_total_lines_changed.outputs.total_lines_changed }} is greater than ${maxLinesChanged}. Please consider breaking this PR down.`,
          },
        },
        {
          id: 'fail',
          if: `$\{{ fromJSON(steps.get_total_lines_changed.outputs.total_lines_changed) > fromJSON(${maxLinesChanged}) }}`,
          run: 'exit 1',
        },
      ],
    });
  }
}
