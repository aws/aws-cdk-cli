export const SUPPORTED_LANGUAGES: { name: string; alias: string }[] = [
  { name: 'csharp', alias: 'cs' },
  { name: 'fsharp', alias: 'fs' },
  { name: 'go', alias: 'go' },
  { name: 'java', alias: 'java' },
  { name: 'javascript', alias: 'js' },
  { name: 'python', alias: 'py' },
  { name: 'typescript', alias: 'ts' },
];

/**
 * get the language alias from the language name or alias
 *
 * @example
 * getLanguageAlias('typescript') // returns 'ts'
 * getLanguageAlias('python') // returns 'py'
 */
export function getLanguageAlias(language: string): string | undefined {
  return SUPPORTED_LANGUAGES.find((l) => l.name === language || l.alias === language)?.alias;
}

/**
 * get the language name from the language alias or name
 *
 * @example
 * getLanguageFromAlias('ts') // returns 'typescript'
 * getLanguageFromAlias('py') // returns 'python'
 */
export function getLanguageFromAlias(alias: string): string | undefined {
  return SUPPORTED_LANGUAGES.find((l) => l.alias === alias || l.name === alias)?.name;
}
