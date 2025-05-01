import type { Account } from './sdk-provider';
/**
 * Disk cache which maps access key IDs to account IDs.
 * Usage:
 *   cache.get(accessKey) => accountId | undefined
 *   cache.put(accessKey, accountId)
 */
export declare class AccountAccessKeyCache {
    /**
     * Max number of entries in the cache, after which the cache will be reset.
     */
    static readonly MAX_ENTRIES = 1000;
    /**
     * The default path used for the accounts access key cache
     */
    static get DEFAULT_PATH(): string;
    private readonly cacheFile;
    private readonly debug;
    /**
     * @param filePath Path to the cache file
     */
    constructor(filePath: string | undefined, debugFn: (msg: string) => Promise<void>);
    /**
     * Tries to fetch the account ID from cache. If it's not in the cache, invokes
     * the resolver function which should retrieve the account ID and return it.
     * Then, it will be stored into disk cache returned.
     *
     * Example:
     *
     *    const accountId = cache.fetch(accessKey, async () => {
     *      return await fetchAccountIdFromSomewhere(accessKey);
     *    });
     */
    fetch<A extends Account>(accessKeyId: string, resolver: () => Promise<A>): Promise<Account>;
    /** Get the account ID from an access key or undefined if not in cache */
    get(accessKeyId: string): Promise<Account | undefined>;
    /** Put a mapping between access key and account ID */
    put(accessKeyId: string, account: Account): Promise<void>;
    private loadMap;
    private saveMap;
}
