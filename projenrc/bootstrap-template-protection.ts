import type { IConstruct } from 'constructs';
import { Component, github as gh } from 'projen';
import { GitHub } from 'projen/lib/github';

export interface BootstrapTemplateProtectionOptions {
  readonly bootstrapTemplatePath?: string;
}

export class BootstrapTemplateProtection extends Component {
  constructor(scope: IConstruct, options: BootstrapTemplateProtectionOptions = {}) {
    super(scope);

    const SECURITY_REVIEWED_LABEL = 'pr/security-reviewed';
    const VERSION_EXEMPT_LABEL = 'pr/exempt-bootstrap-version';
    const BOOTSTRAP_TEMPLATE_PATH = options.bootstrapTemplatePath ?? 'packages/aws-cdk/lib/api/bootstrap/bootstrap-template.yaml';

    const github = GitHub.of(this.project);
    if (!github) {
      throw new Error('BootstrapTemplateProtection requires a GitHub project');
    }

    const workflow = github.addWorkflow('bootstrap-template-protection');

    workflow.on({
      pullRequest: {
        types: ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled'],
      },
      mergeGroup: {},
    });

    workflow.addJob('check-bootstrap-template', {
      name: 'Check Bootstrap Template Changes',
      runsOn: ['ubuntu-latest'],
      if: "(github.event_name == 'pull_request' || github.event_name == 'pull_request_target')",
      permissions: {
        contents: gh.workflows.JobPermission.READ,
        pullRequests: gh.workflows.JobPermission.WRITE,
      },
      steps: [
        {
          name: 'Checkout merge commit',
          uses: 'actions/checkout@v4',
          with: {
            'fetch-depth': 0,
            'ref': 'refs/pull/${{ github.event.pull_request.number }}/merge',
          },
        },
        {
          name: 'Checkout base branch',
          run: 'git fetch origin ${{ github.event.pull_request.base.ref }}',
        },
        {
          name: 'Check if bootstrap template changed',
          id: 'template-changed',
          run: [
            '# Check if the bootstrap template differs between base and merge commit',
            `if ! git diff --quiet --name-only origin/\${{ github.event.pull_request.base.ref }}..HEAD -- ${BOOTSTRAP_TEMPLATE_PATH}; then`,
            '  echo "Bootstrap template modified - protection checks required"',
            '  echo "changed=true" >> $GITHUB_OUTPUT',
            'else',
            '  echo "✅ Bootstrap template not modified - no protection required"',
            '  echo "changed=false" >> $GITHUB_OUTPUT',
            'fi',
          ].join('\n'),
        },
        {
          name: 'Extract current and previous bootstrap versions',
          if: 'steps.template-changed.outputs.changed == \'true\'',
          id: 'version-check',
          run: [
            '# Get current version from PR - look for CdkBootstrapVersion Value',
            `CURRENT_VERSION=$(yq '.Resources.CdkBootstrapVersion.Properties.Value' ${BOOTSTRAP_TEMPLATE_PATH})`,
            '',
            '# Get previous version from base branch',
            `git show origin/\${{ github.event.pull_request.base.ref }}:${BOOTSTRAP_TEMPLATE_PATH} > /tmp/base-template.yaml`,
            'PREVIOUS_VERSION=$(yq \'.Resources.CdkBootstrapVersion.Properties.Value\' /tmp/base-template.yaml)',
            '',
            'echo "current-version=$CURRENT_VERSION" >> $GITHUB_OUTPUT',
            'echo "previous-version=$PREVIOUS_VERSION" >> $GITHUB_OUTPUT',
            '',
            'if [ "$CURRENT_VERSION" -gt "$PREVIOUS_VERSION" ]; then',
            '  echo "version-incremented=true" >> $GITHUB_OUTPUT',
            'else',
            '  echo "version-incremented=false" >> $GITHUB_OUTPUT',
            'fi',
          ].join('\n'),
        },
        {
          name: 'Check for security review and exemption labels',
          if: 'steps.template-changed.outputs.changed == \'true\'',
          id: 'label-check',
          run: [
            `if [[ "\${{ contains(github.event.pull_request.labels.*.name, '${SECURITY_REVIEWED_LABEL}') }}" == "true" ]]; then`,
            '  echo "has-security-label=true" >> $GITHUB_OUTPUT',
            'else',
            '  echo "has-security-label=false" >> $GITHUB_OUTPUT',
            'fi',
            '',
            `if [[ "\${{ contains(github.event.pull_request.labels.*.name, '${VERSION_EXEMPT_LABEL}') }}" == "true" ]]; then`,
            '  echo "has-version-exempt-label=true" >> $GITHUB_OUTPUT',
            'else',
            '  echo "has-version-exempt-label=false" >> $GITHUB_OUTPUT',
            'fi',
          ].join('\n'),
        },
        {
          name: 'Post comment',
          if: 'steps.template-changed.outputs.changed == \'true\'',
          uses: 'thollander/actions-comment-pull-request@v3',
          with: {
            'comment-tag': 'bootstrap-template-protection',
            'mode': 'recreate',
            'message': [
              '## ⚠️ Bootstrap Template Protection',
              '',
              `This PR modifies the bootstrap template (\`${BOOTSTRAP_TEMPLATE_PATH}\`), which requires special protections.`,
              '',
              '${{ ((steps.version-check.outputs.version-incremented == \'true\' || steps.label-check.outputs.has-version-exempt-label == \'true\') && steps.label-check.outputs.has-security-label == \'true\') && \'**✅ All requirements met! This PR can proceed with normal review process.**\' || \'**❌ This PR cannot be merged until all requirements are met.**\' }}',
              '',
              '### Requirements',
              '',
              '**Version Increment**',
              `\${{ (steps.version-check.outputs.version-incremented == \'true\' && format(\'✅ Version incremented from {0} to {1}\', steps.version-check.outputs.previous-version, steps.version-check.outputs.current-version)) || (steps.label-check.outputs.has-version-exempt-label == 'true' && format('✅ Version increment exempted (PR has \`{0}\` label)', '${VERSION_EXEMPT_LABEL}')) || '❌ Version increment required' }}`,
              '${{ steps.version-check.outputs.version-incremented != \'true\' && steps.label-check.outputs.has-version-exempt-label != \'true\' && format(\'   - Current version: `{0}`\', steps.version-check.outputs.current-version) || \'\' }}',
              '${{ steps.version-check.outputs.version-incremented != \'true\' && steps.label-check.outputs.has-version-exempt-label != \'true\' && format(\'   - Previous version: `{0}`\', steps.version-check.outputs.previous-version) || \'\' }}',
              '${{ steps.version-check.outputs.version-incremented != \'true\' && steps.label-check.outputs.has-version-exempt-label != \'true\' && \'   - Please increment the version in `CdkBootstrapVersion`\' || \'\' }}',
              `\${{ steps.version-check.outputs.version-incremented != 'true' && steps.label-check.outputs.has-version-exempt-label != 'true' && format('   - Or add the \`{0}\` label if not needed', '${VERSION_EXEMPT_LABEL}') || '' }}`,
              '',
              '**Security Review**',
              `\${{ (steps.label-check.outputs.has-security-label == 'true' && format('✅ Review completed (PR has \`{0}\` label)', '${SECURITY_REVIEWED_LABEL}')) || '❌ Review required' }}`,
              '${{ steps.label-check.outputs.has-security-label != \'true\' && \'   - A maintainer will conduct a security review\' || \'\' }}',
              `\${{ steps.label-check.outputs.has-security-label != 'true' && format('   - Once reviewed, they will add the \`{0}\` label', '${SECURITY_REVIEWED_LABEL}') || '' }}`,
              '',
              '### Why these protections exist',
              '- The bootstrap template contains critical infrastructure',
              '- Changes can affect IAM roles, policies, and resource access across all CDK deployments',
              '- Version increments ensure users are notified of updates',
              '',
            ].join('\n'),
          },
        },
        {
          name: 'Check requirements',
          if: 'steps.template-changed.outputs.changed == \'true\'',
          run: [
            '# Check version requirement (either incremented or exempted)',
            'VERSION_INCREMENTED="${{ steps.version-check.outputs.version-incremented }}"',
            'VERSION_EXEMPTED="${{ steps.label-check.outputs.has-version-exempt-label }}"',
            'SECURITY_REVIEWED="${{ steps.label-check.outputs.has-security-label }}"',
            '',
            '# Both requirements must be met',
            'if [[ "$VERSION_INCREMENTED" == "true" || "$VERSION_EXEMPTED" == "true" ]] && [[ "$SECURITY_REVIEWED" == "true" ]]; then',
            '  echo "✅ All requirements met!"',
            '  exit 0',
            'fi',
            '',
            '# Show what\'s missing',
            'echo "❌ Requirements not met:"',
            'if [[ "$VERSION_INCREMENTED" != "true" && "$VERSION_EXEMPTED" != "true" ]]; then',
            `  echo "  - Version must be incremented OR add '${VERSION_EXEMPT_LABEL}' label"`,
            'fi',
            'if [[ "$SECURITY_REVIEWED" != "true" ]]; then',
            `  echo "  - PR must have '${SECURITY_REVIEWED_LABEL}' label"`,
            'fi',
            'exit 1',
          ].join('\n'),
        },
      ],
    });
  }
}
