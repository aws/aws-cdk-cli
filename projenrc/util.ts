export enum GitHubToken {
  GITHUB_TOKEN = 'secrets.GITHUB_TOKEN',
  PROJEN_GITHUB_TOKEN = 'secrets.PROJEN_GITHUB_TOKEN',
}

export function stringifyList(list: string[]) {
  return `[${list.join('|')}]`;
}
