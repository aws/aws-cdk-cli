import * as fs from 'fs-extra';

/**
 * Whether an error from an AWS SDK call is an authorization failure.
 *
 * Services are inconsistent in how they phrase it: most raise `AccessDeniedException`
 * (e.g. CloudTrail, SSM), some `AccessDenied` (e.g. S3), and some surface the code on
 * `Code` rather than `name`. Match all of them.
 */
export function isAccessDeniedError(e: any): boolean {
  const name = e?.name ?? e?.Code ?? '';
  return name === 'AccessDenied' || name === 'AccessDeniedException';
}

/**
 * Read a file if it exists, or return undefined
 *
 * Not async because it is used in the constructor
 */
export function readIfPossible(filename: string): string | undefined {
  try {
    if (!fs.pathExistsSync(filename)) {
      return undefined;
    }
    return fs.readFileSync(filename, { encoding: 'utf-8' });
  } catch (e: any) {
    return undefined;
  }
}
