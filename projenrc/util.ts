import { github } from 'projen';

export class GitHubToken {
  public static readonly GITHUB_TOKEN = github.GithubCredentials.fromPersonalAccessToken({
    secret: 'GITHUB_TOKEN',
  });
}

export function stringifyList(list: string[]) {
  return `[${list.join('|')}]`;
}
