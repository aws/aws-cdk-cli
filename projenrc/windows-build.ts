import { Component, github } from 'projen';
import type { JobStep } from 'projen/lib/github/workflows-model';
import { JobPermission } from 'projen/lib/github/workflows-model';
import type { TypeScriptProject } from 'projen/lib/typescript';

export interface WindowsBuildWorkflowProps {
  /**
   * Packages to compile and unit test on Windows.
   *
   * Compilation of their transitive workspace dependencies is handled by NX.
   */
  readonly packages: string[];

  /**
   * Steps to run after compilation but before the tests.
   *
   * Use this to generate files that tests depend on, which would normally be
   * produced by pre/post-compile steps this workflow does not run. All steps
   * run under Git Bash.
   */
  readonly preTestSteps?: JobStep[];
}

/**
 * Compile and unit test a subset of packages on Windows.
 *
 * This deliberately does not run the full `build` task: pre/post-compile
 * steps of several packages invoke shell scripts (`generate.sh`,
 * `build-info.sh`) and other POSIX-isms that do not work on Windows runners.
 */
export class WindowsBuildWorkflow extends Component {
  public readonly workflow: github.GithubWorkflow;

  constructor(repo: TypeScriptProject, props: WindowsBuildWorkflowProps) {
    super(repo);

    if (!repo.github) {
      throw new Error('Given repository does not have a GitHub component');
    }

    this.workflow = repo.github.addWorkflow('windows-build');
    this.workflow.on({
      pullRequest: {},
      workflowDispatch: {},
      mergeGroup: {},
    });

    this.workflow.addJob('build', {
      runsOn: ['windows-latest'],
      permissions: { contents: JobPermission.READ },
      timeoutMinutes: 90,
      env: {
        CI: 'true',
      },
      defaults: {
        run: {
          // Git Bash: keeps workflow plumbing identical to the Linux jobs,
          // while tests still exercise Node.js on Windows (paths, subprocesses)
          shell: 'bash',
        },
      },
      steps: [
        github.WorkflowSteps.checkout(),
        {
          name: 'Enable corepack',
          run: 'corepack enable',
        },
        {
          name: 'Setup Node.js',
          uses: 'actions/setup-node@v6',
          with: {
            'node-version': 'lts/*',
            'package-manager-cache': false,
          },
        },
        {
          name: 'Install dependencies',
          run: 'yarn install --immutable',
        },
        {
          name: 'Compile',
          run: `yarn nx run-many -t compile -p ${props.packages.join(' ')}`,
        },
        ...props.preTestSteps ?? [],
        ...props.packages.map((pkg) => ({
          name: `Test ${pkg}`,
          run: 'npx jest --passWithNoTests',
          workingDirectory: `packages/${pkg}`,
          env: {
            NODE_OPTIONS: '--experimental-vm-modules',
          },
        })),
      ],
    });
  }
}
