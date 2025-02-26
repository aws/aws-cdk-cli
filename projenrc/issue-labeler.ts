import { Component, github } from 'projen';
import { JobPermission } from 'projen/lib/github/workflows-model';
import { TypeScriptProject } from 'projen/lib/typescript';

const OSDS_DEVS = ['ashishdhingra', 'khushail', 'hunhsieh'];
const AREA_AFFIXES = ['@aws-cdk/'];
const AREA_PARAMS = [
  { area: '@aws-cdk/cli-lib-alpha', keywords: ['cli', 'cli-lib', 'cli-lib-alpha'], labels: ['@aws-cdk/cli-lib-alpha'] },
  { area: '@aws-cdk/cloud-assembly-schema', keywords: ['cloud-assembly', 'schema'], labels: ['@aws-cdk/cloud-assembly-schema'] },
  { area: '@aws-cdk/cloudformation-diff', keywords: ['diff', 'cloudformation'], labels: ['@aws-cdk/cloudformation-diff'] },
  { area: '@aws-cdk/toolkit-lib', keywords: ['toolkit', 'programmtic toolkit', 'toolkit-lib'], labels: ['@aws-cdk/toolkit-lib'] },
  { area: 'aws-cdk', keywords: ['aws-cdk', 'cli', 'cdk cli'], labels: ['aws-cdk'] },
  { area: 'cdk-assets', keywords: ['assets', 'cdk-assets'], labels: ['cdk-assets'] },
];

enum GitHubToken {
  GITHUB_TOKEN = 'secrets.GITHUB_TOKEN',
  PROJEN_GITHUB_TOKEN = 'secrets.PROJEN_GITHUB_TOKEN',
}

/**
 * See https://github.com/aws-github-ops/aws-issue-triage-manager
 */
interface TriageManagerOptions {
  target: 'pull-requests' | 'issues' | 'both';
  excludedExpressions?: string[];
  includedLabels?: string[];
  excludedLabels?: string[];
  defaultArea?: string;
  parameters?: string;
  affixes?: string;
  areaIsKeyword?: boolean;
  /**
   * Whether or not the env variables are needed for the job.
   * Workflow-level env variables are not configurable via Projen
   */
  needEnvs?: boolean;
  /**
   * @default GitHubToken.GITHUB_TOKEN
   */
  githubToken?: GitHubToken;
}

function stringifyList(list: string[]) {
  return `[${list.join('|')}]`;
}

function triageManagerJob(triageManagerOptions: TriageManagerOptions) {
  return {
    name: 'Triage Manager',
    runsOn: ['aws-cdk_ubuntu-latest_4-core'],
    permissions: { issues: JobPermission.WRITE, pullRequests: JobPermission.WRITE },
    steps: [
      {
        name: 'Triage Manager',
        uses: 'aws-github-ops/aws-issue-triage-manager@main',
        with: {
          'github-token': `\${{ ${triageManagerOptions.githubToken ?? 'secrets.GITHUB_TOKEN'} }}`,
          target: triageManagerOptions.target,
          'excluded-expressions': triageManagerOptions.excludedExpressions ? stringifyList(triageManagerOptions.excludedExpressions) : undefined,
          'included-labels': triageManagerOptions.includedLabels ? stringifyList(triageManagerOptions.includedLabels) : undefined,
          'excluded-labels': triageManagerOptions.excludedLabels ? stringifyList(triageManagerOptions.excludedLabels) : undefined,
          'default-area': triageManagerOptions.defaultArea,
          parameters: triageManagerOptions.parameters,
          affixes: triageManagerOptions.affixes,
          'area-is-keyword': triageManagerOptions.areaIsKeyword,
        },
      },
    ],
    ...(triageManagerOptions.needEnvs ? {
      env: {
        AREA_PARAMS: JSON.stringify(AREA_PARAMS),
        AREA_AFFIXES: `{"prefixes":${JSON.stringify(AREA_AFFIXES)}}`,
        OSDS_DEVS: `{"assignees":${JSON.stringify(OSDS_DEVS)}}`,
      },
    } : {}),
  };
}

export class IssueLabeler extends Component {
  public readonly workflow: github.GithubWorkflow;

  constructor(repo: TypeScriptProject) {
    super(repo);

    if (!repo.github) {
      throw new Error('Given repository does not have a GitHub component');
    }

    this.workflow = repo.github.addWorkflow('issue-label-assign');
    this.workflow.on({
      pullRequestTarget: { types: ['opened'] },
      issues: { types: ['opened', 'edited'] },
    });

    this.workflow.addJob('Triage Issues', triageManagerJob({
      target: 'issues',
      excludedExpressions: ['CDK CLI Version', 'TypeScript', 'Java', 'Python', 'Go'],
      includedLabels: ['needs-triage'],
      excludedLabels: ['p1', 'p2', 'p0', 'effort-small', 'effort-medium', 'effort-large', 'guidance'],
      defaultArea: '${{ env.OSDS_DEVS }}',
      parameters: '${{ env.AREA_PARAMS }}',
      affixes: '${{ env.AREA_AFFIXES }}',
      needEnvs: true,
    }));
    this.workflow.addJob('Triage Pull Requests', triageManagerJob({
      target: 'pull-requests',
      areaIsKeyword: true,
      defaultArea: '{"reviewers":{"teamReviewers":["aws-cdk-owners"]}}',
      parameters: '[{"area":"pullrequests","keywords":["pullrequestkeyword"]}]',
      githubToken: GitHubToken.PROJEN_GITHUB_TOKEN,
    }));
  }
}
