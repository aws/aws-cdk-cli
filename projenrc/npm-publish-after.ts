import type { Monorepo } from 'cdklabs-projen-project-types/lib/yarn';
import type { Project } from 'projen';
import { Component, github } from 'projen';

/**
 * Make a package's npm publish job wait for the npm publish jobs of other packages.
 *
 * Release jobs are ordered by declared package dependencies. Use this for
 * ordering that isn't expressed as a dependency.
 */
export class NpmPublishAfter extends Component {
  constructor(
    private readonly project_: Monorepo,
    private readonly pkg: Project,
    private readonly after: Project[],
  ) {
    super(project_);
  }

  public preSynthesize() {
    const releaseWf = this.project_.github?.tryFindWorkflow('release');
    if (!releaseWf) {
      throw new Error('Could not find release workflow');
    }

    const jobId = npmJobId(this.pkg);
    const job = releaseWf.getJob(jobId) as github.workflows.Job | undefined;
    if (!job) {
      throw new Error(`Could not find job ${jobId} in release workflow`);
    }

    releaseWf.updateJob(jobId, {
      ...job,
      needs: [...(job.needs ?? []), ...this.after.map(npmJobId)],
    });
  }
}

function npmJobId(project: Project) {
  return `${project.name.replace('@', '').replace('/', '-')}_release_npm`;
}
