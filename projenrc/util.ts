import { github } from 'projen';

export class GitHubToken {
  public static readonly GITHUB_TOKEN = github.GithubCredentials.fromPersonalAccessToken({
    secret: 'GITHUB_TOKEN',
  });
}

export function stringifyList(list: string[]) {
  return `[${list.join('|')}]`;
}

/**
 * Workflow `if` condition for jobs that should run after a package's npm publish job.
 *
 * `!cancelled()` opts out of the implicit (transitive) `success()` gate that would
 * otherwise skip the job whenever any unrelated package in the release graph wasn't
 * republished. We gate on the direct publish job's result instead.
 */
export function runAfterPublish(npmJobId: string): string {
  return `\${{ !cancelled() && needs.${npmJobId}.result == 'success' && !inputs.dry_run }}`;
}
