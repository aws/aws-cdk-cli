import * as semver from 'semver';
import { ToolkitError } from '../toolkit/toolkit-error';

// bracket - https://docs.oracle.com/middleware/1212/core/MAVEN/maven_version.htm#MAVEN401
// pep - https://www.python.org/dev/peps/pep-0440/#version-specifiers
export type RangeType = 'bracket' | 'major.*' | 'pep' ;

export function rangeFromSemver(ver: string, targetType: RangeType) {
  const re = ver.match(/^([^\d]*)([\d.]*)[^\s]*$/);
  if (!re || !semver.valid(re[2])) {
    throw new ToolkitError('not a semver or unsupported range syntax');
  }
  const prefixPart = re[1];
  const verPart = re[2];

  switch (targetType) {
    // NuGet normally installs the lowest version in the range
    // That's okay for aws-cdk-lib where we always specify the lowest version
    // For constructs, we rather want people to use the highest version
    // The only way to do this is to specify this as <MAJOR>.*
    // see https://learn.microsoft.com/en-us/nuget/concepts/package-versioning
    case 'major.*':
      switch (prefixPart) {
        case '':
          // if there's no prefix and the remaining is a valid semver, there's no range specified
          return ver;
        case '^':
          return `${semver.major(verPart)}.*`;
        default:
          throw new ToolkitError(`unsupported range syntax - ${prefixPart}`);
      }
    case 'bracket':
      switch (prefixPart) {
        case '':
          // if there's no prefix and the remaining is a valid semver, there's no range specified
          return ver;
        case '^':
          return `[${verPart},${semver.major(verPart)+1}.0.0)`;
        default:
          throw new ToolkitError(`unsupported range syntax - ${prefixPart}`);
      }
    case 'pep':
      switch (prefixPart) {
        case '':
          // if there's no prefix and the remaining is a valid semver, there's no range specified
          return `==${ver}`;
        case '^':
          return `>=${verPart},<${semver.major(verPart)+1}.0.0`;
        default:
          throw new ToolkitError(`unsupported range syntax - ${prefixPart}`);
      }
  }
}

/**
 * Strips a leading caret ^, if present
 */
export function stripCaret(ver: string): string {
  return ver.startsWith('^') ? ver.slice(1) : ver;
}
