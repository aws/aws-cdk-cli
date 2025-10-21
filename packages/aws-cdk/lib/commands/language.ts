export interface LanguageInfo {
  name: string;
  alias: string;
  extensions: string[];
}

export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { name: 'csharp', alias: 'cs', extensions: ['.cs'] },
  { name: 'fsharp', alias: 'fs', extensions: ['.fs'] },
  { name: 'go', alias: 'go', extensions: ['.go'] },
  { name: 'java', alias: 'java', extensions: ['.java'] },
  { name: 'javascript', alias: 'js', extensions: ['.js'] },
  { name: 'python', alias: 'py', extensions: ['.py'] },
  { name: 'typescript', alias: 'ts', extensions: ['.ts', '.js'] },
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

/**
 * get the file extensions for a given language name or alias
 *
 * @example
 * getLanguageExtensions('typescript') // returns ['.ts', '.js']
 * getLanguageExtensions('python') // returns ['.py']
 */
export function getLanguageExtensions(language: string): string[] {
  return SUPPORTED_LANGUAGES.find((l) => l.name === language || l.alias === language)?.extensions ?? [];
}
