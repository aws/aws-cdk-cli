export function patternsArrayForWatch(
  patterns: string | string[] | undefined,
  options: { rootDir: string; returnRootDirIfEmpty: boolean },
): string[] {
  const patternsArray: string[] = patterns !== undefined ? (Array.isArray(patterns) ? patterns : [patterns]) : [];
  return patternsArray.length > 0 ? patternsArray : options.returnRootDirIfEmpty ? [options.rootDir] : [];
}
