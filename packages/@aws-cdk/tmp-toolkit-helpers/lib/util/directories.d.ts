/**
 * Return a location that will be used as the CDK home directory.
 * Currently the only thing that is placed here is the cache.
 *
 * First try to use the users home directory (i.e. /home/someuser/),
 * but if that directory does not exist for some reason create a tmp directory.
 *
 * Typically it wouldn't make sense to create a one time use tmp directory for
 * the purpose of creating a cache, but since this only applies to users that do
 * not have a home directory (some CI systems?) this should be fine.
 */
export declare function cdkHomeDir(): string;
export declare function cdkCacheDir(): string;
/**
 * From the start location, find the directory that contains the bundled package's package.json
 *
 * You must assume the caller of this function will be bundled and the package root dir
 * is not going to be the same as the package the caller currently lives in.
 */
export declare function bundledPackageRootDir(start: string): string;
export declare function bundledPackageRootDir(start: string, fail: true): string;
export declare function bundledPackageRootDir(start: string, fail: false): string | undefined;
