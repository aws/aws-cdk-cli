import type { ITestCliSource, ITestLibrarySource } from './package-sources/source';
import { testSource } from './package-sources/subprocess';

export interface PackageContext {
  cli: ITestCliSource;
  library: ITestLibrarySource;
}

export function withPackages<A extends object>(block: (context: A & PackageContext) => Promise<void>) {
  return async (context: A) => {
    return block({
      ...context,
      cli: testSource('cli'),
      library: testSource('library'),
    });
  };
}
