import type { github } from 'projen';
import { Component } from 'projen';
import { JobPermission } from 'projen/lib/github/workflows-model';
import type { TypeScriptProject } from 'projen/lib/typescript';
import { GitHubToken, stringifyList } from './util';

/**
 * See https://github.com/cdklabs/pr-triage-manager
 */
interface PrLabelerOptions {
  /**
   * @default GitHubToken.GITHUB_TOKEN
   */
  credentials?: github.GithubCredentials;
  priorityLabels?: string[];
  classificationLabels?: string[];
  onPulls?: boolean;
}

function prLabelerJob(prLabelerOptions: PrLabelerOptions = {}) {
  const credentials = prLabelerOptions.credentials ?? GitHubToken.GITHUB_TOKEN;
  return {
    name: 'PR Labeler',
    runsOn: ['aws-cdk_ubuntu-latest_4-core'],
    permissions: { issues: JobPermission.WRITE, pullRequests: JobPermission.WRITE },
    environment: credentials.environment,
    steps: [
      ...credentials.setupSteps,
      {
        name: 'PR Labeler',
        uses: 'cdklabs/pr-triage-manager@main',
        with: {
          'github-token': credentials.tokenRef,
          'priority-labels': prLabelerOptions.priorityLabels ? stringifyList(prLabelerOptions.priorityLabels) : undefined,
          'classification-labels': prLabelerOptions.classificationLabels ? stringifyList(prLabelerOptions.classificationLabels) : undefined,
          'on-pulls': prLabelerOptions.onPulls,
        },
      },
    ],
  };
}

export class PrLabeler extends Component {
  public readonly workflow: github.GithubWorkflow;

  constructor(repo: TypeScriptProject) {
    super(repo);

    if (!repo.github) {
      throw new Error('Given repository does not have a GitHub component');
    }

    this.workflow = repo.github.addWorkflow('pr-labeler');
    this.workflow.on({
      pullRequestTarget: { types: ['opened', 'edited', 'reopened'] },
    });

    this.workflow.addJob('copy-labels', prLabelerJob());
  }
}
