"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountAccessKeyCache = void 0;
const path = require("path");
const fs = require("fs-extra");
const util_1 = require("../../util");
/**
 * Disk cache which maps access key IDs to account IDs.
 * Usage:
 *   cache.get(accessKey) => accountId | undefined
 *   cache.put(accessKey, accountId)
 */
class AccountAccessKeyCache {
    /**
     * Max number of entries in the cache, after which the cache will be reset.
     */
    static MAX_ENTRIES = 1000;
    /**
     * The default path used for the accounts access key cache
     */
    static get DEFAULT_PATH() {
        // needs to be a getter because cdkCacheDir can be set via env variable and might change
        return path.join((0, util_1.cdkCacheDir)(), 'accounts_partitions.json');
    }
    cacheFile;
    debug;
    /**
     * @param filePath Path to the cache file
     */
    constructor(filePath = AccountAccessKeyCache.DEFAULT_PATH, debugFn) {
        this.cacheFile = filePath;
        this.debug = debugFn;
    }
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
    async fetch(accessKeyId, resolver) {
        // try to get account ID based on this access key ID from disk.
        const cached = await this.get(accessKeyId);
        if (cached) {
            await this.debug(`Retrieved account ID ${cached.accountId} from disk cache`);
            return cached;
        }
        // if it's not in the cache, resolve and put in cache.
        const account = await resolver();
        if (account) {
            await this.put(accessKeyId, account);
        }
        return account;
    }
    /** Get the account ID from an access key or undefined if not in cache */
    async get(accessKeyId) {
        const map = await this.loadMap();
        return map[accessKeyId];
    }
    /** Put a mapping between access key and account ID */
    async put(accessKeyId, account) {
        let map = await this.loadMap();
        // nuke cache if it's too big.
        if (Object.keys(map).length >= AccountAccessKeyCache.MAX_ENTRIES) {
            map = {};
        }
        map[accessKeyId] = account;
        await this.saveMap(map);
    }
    async loadMap() {
        try {
            return await fs.readJson(this.cacheFile);
        }
        catch (e) {
            // File doesn't exist or is not readable. This is a cache,
            // pretend we successfully loaded an empty map.
            if (e.code === 'ENOENT' || e.code === 'EACCES') {
                return {};
            }
            // File is not JSON, could be corrupted because of concurrent writes.
            // Again, an empty cache is fine.
            if (e instanceof SyntaxError) {
                return {};
            }
            throw e;
        }
    }
    async saveMap(map) {
        try {
            await fs.ensureFile(this.cacheFile);
            await fs.writeJson(this.cacheFile, map, { spaces: 2 });
        }
        catch (e) {
            // File doesn't exist or file/dir isn't writable. This is a cache,
            // if we can't write it then too bad.
            if (e.code === 'ENOENT' || e.code === 'EACCES' || e.code === 'EROFS') {
                return;
            }
            throw e;
        }
    }
}
exports.AccountAccessKeyCache = AccountAccessKeyCache;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWNjb3VudC1jYWNoZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvYXdzLWF1dGgvYWNjb3VudC1jYWNoZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2QkFBNkI7QUFDN0IsK0JBQStCO0FBRS9CLHFDQUF5QztBQUV6Qzs7Ozs7R0FLRztBQUNILE1BQWEscUJBQXFCO0lBQ2hDOztPQUVHO0lBQ0ksTUFBTSxDQUFVLFdBQVcsR0FBRyxJQUFJLENBQUM7SUFFMUM7O09BRUc7SUFDSSxNQUFNLEtBQUssWUFBWTtRQUM1Qix3RkFBd0Y7UUFDeEYsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUEsa0JBQVcsR0FBRSxFQUFFLDBCQUEwQixDQUFDLENBQUM7SUFDOUQsQ0FBQztJQUVnQixTQUFTLENBQVM7SUFFbEIsS0FBSyxDQUFpQztJQUV2RDs7T0FFRztJQUNILFlBQVksV0FBbUIscUJBQXFCLENBQUMsWUFBWSxFQUFFLE9BQXVDO1FBQ3hHLElBQUksQ0FBQyxTQUFTLEdBQUcsUUFBUSxDQUFDO1FBQzFCLElBQUksQ0FBQyxLQUFLLEdBQUcsT0FBTyxDQUFDO0lBQ3ZCLENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0ksS0FBSyxDQUFDLEtBQUssQ0FBb0IsV0FBbUIsRUFBRSxRQUEwQjtRQUNuRiwrREFBK0Q7UUFDL0QsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQzNDLElBQUksTUFBTSxFQUFFLENBQUM7WUFDWCxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsd0JBQXdCLE1BQU0sQ0FBQyxTQUFTLGtCQUFrQixDQUFDLENBQUM7WUFDN0UsT0FBTyxNQUFNLENBQUM7UUFDaEIsQ0FBQztRQUVELHNEQUFzRDtRQUN0RCxNQUFNLE9BQU8sR0FBRyxNQUFNLFFBQVEsRUFBRSxDQUFDO1FBQ2pDLElBQUksT0FBTyxFQUFFLENBQUM7WUFDWixNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7UUFFRCxPQUFPLE9BQU8sQ0FBQztJQUNqQixDQUFDO0lBRUQseUVBQXlFO0lBQ2xFLEtBQUssQ0FBQyxHQUFHLENBQUMsV0FBbUI7UUFDbEMsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDakMsT0FBTyxHQUFHLENBQUMsV0FBVyxDQUFDLENBQUM7SUFDMUIsQ0FBQztJQUVELHNEQUFzRDtJQUMvQyxLQUFLLENBQUMsR0FBRyxDQUFDLFdBQW1CLEVBQUUsT0FBZ0I7UUFDcEQsSUFBSSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7UUFFL0IsOEJBQThCO1FBQzlCLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLElBQUkscUJBQXFCLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakUsR0FBRyxHQUFHLEVBQUUsQ0FBQztRQUNYLENBQUM7UUFFRCxHQUFHLENBQUMsV0FBVyxDQUFDLEdBQUcsT0FBTyxDQUFDO1FBQzNCLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUMxQixDQUFDO0lBRU8sS0FBSyxDQUFDLE9BQU87UUFDbkIsSUFBSSxDQUFDO1lBQ0gsT0FBTyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzNDLENBQUM7UUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO1lBQ2hCLDBEQUEwRDtZQUMxRCwrQ0FBK0M7WUFDL0MsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVEsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUMvQyxPQUFPLEVBQUUsQ0FBQztZQUNaLENBQUM7WUFDRCxxRUFBcUU7WUFDckUsaUNBQWlDO1lBQ2pDLElBQUksQ0FBQyxZQUFZLFdBQVcsRUFBRSxDQUFDO2dCQUM3QixPQUFPLEVBQUUsQ0FBQztZQUNaLENBQUM7WUFDRCxNQUFNLENBQUMsQ0FBQztRQUNWLENBQUM7SUFDSCxDQUFDO0lBRU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxHQUF1QztRQUMzRCxJQUFJLENBQUM7WUFDSCxNQUFNLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQ3BDLE1BQU0sRUFBRSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEdBQUcsRUFBRSxFQUFFLE1BQU0sRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3pELENBQUM7UUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO1lBQ2hCLGtFQUFrRTtZQUNsRSxxQ0FBcUM7WUFDckMsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVEsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVEsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLE9BQU8sRUFBRSxDQUFDO2dCQUNyRSxPQUFPO1lBQ1QsQ0FBQztZQUNELE1BQU0sQ0FBQyxDQUFDO1FBQ1YsQ0FBQztJQUNILENBQUM7O0FBdkdILHNEQXdHQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcy1leHRyYSc7XG5pbXBvcnQgdHlwZSB7IEFjY291bnQgfSBmcm9tICcuL3Nkay1wcm92aWRlcic7XG5pbXBvcnQgeyBjZGtDYWNoZURpciB9IGZyb20gJy4uLy4uL3V0aWwnO1xuXG4vKipcbiAqIERpc2sgY2FjaGUgd2hpY2ggbWFwcyBhY2Nlc3Mga2V5IElEcyB0byBhY2NvdW50IElEcy5cbiAqIFVzYWdlOlxuICogICBjYWNoZS5nZXQoYWNjZXNzS2V5KSA9PiBhY2NvdW50SWQgfCB1bmRlZmluZWRcbiAqICAgY2FjaGUucHV0KGFjY2Vzc0tleSwgYWNjb3VudElkKVxuICovXG5leHBvcnQgY2xhc3MgQWNjb3VudEFjY2Vzc0tleUNhY2hlIHtcbiAgLyoqXG4gICAqIE1heCBudW1iZXIgb2YgZW50cmllcyBpbiB0aGUgY2FjaGUsIGFmdGVyIHdoaWNoIHRoZSBjYWNoZSB3aWxsIGJlIHJlc2V0LlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBNQVhfRU5UUklFUyA9IDEwMDA7XG5cbiAgLyoqXG4gICAqIFRoZSBkZWZhdWx0IHBhdGggdXNlZCBmb3IgdGhlIGFjY291bnRzIGFjY2VzcyBrZXkgY2FjaGVcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZ2V0IERFRkFVTFRfUEFUSCgpOiBzdHJpbmcge1xuICAgIC8vIG5lZWRzIHRvIGJlIGEgZ2V0dGVyIGJlY2F1c2UgY2RrQ2FjaGVEaXIgY2FuIGJlIHNldCB2aWEgZW52IHZhcmlhYmxlIGFuZCBtaWdodCBjaGFuZ2VcbiAgICByZXR1cm4gcGF0aC5qb2luKGNka0NhY2hlRGlyKCksICdhY2NvdW50c19wYXJ0aXRpb25zLmpzb24nKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZG9ubHkgY2FjaGVGaWxlOiBzdHJpbmc7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBkZWJ1ZzogKG1zZzogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+O1xuXG4gIC8qKlxuICAgKiBAcGFyYW0gZmlsZVBhdGggUGF0aCB0byB0aGUgY2FjaGUgZmlsZVxuICAgKi9cbiAgY29uc3RydWN0b3IoZmlsZVBhdGg6IHN0cmluZyA9IEFjY291bnRBY2Nlc3NLZXlDYWNoZS5ERUZBVUxUX1BBVEgsIGRlYnVnRm46IChtc2c6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPikge1xuICAgIHRoaXMuY2FjaGVGaWxlID0gZmlsZVBhdGg7XG4gICAgdGhpcy5kZWJ1ZyA9IGRlYnVnRm47XG4gIH1cblxuICAvKipcbiAgICogVHJpZXMgdG8gZmV0Y2ggdGhlIGFjY291bnQgSUQgZnJvbSBjYWNoZS4gSWYgaXQncyBub3QgaW4gdGhlIGNhY2hlLCBpbnZva2VzXG4gICAqIHRoZSByZXNvbHZlciBmdW5jdGlvbiB3aGljaCBzaG91bGQgcmV0cmlldmUgdGhlIGFjY291bnQgSUQgYW5kIHJldHVybiBpdC5cbiAgICogVGhlbiwgaXQgd2lsbCBiZSBzdG9yZWQgaW50byBkaXNrIGNhY2hlIHJldHVybmVkLlxuICAgKlxuICAgKiBFeGFtcGxlOlxuICAgKlxuICAgKiAgICBjb25zdCBhY2NvdW50SWQgPSBjYWNoZS5mZXRjaChhY2Nlc3NLZXksIGFzeW5jICgpID0+IHtcbiAgICogICAgICByZXR1cm4gYXdhaXQgZmV0Y2hBY2NvdW50SWRGcm9tU29tZXdoZXJlKGFjY2Vzc0tleSk7XG4gICAqICAgIH0pO1xuICAgKi9cbiAgcHVibGljIGFzeW5jIGZldGNoPEEgZXh0ZW5kcyBBY2NvdW50PihhY2Nlc3NLZXlJZDogc3RyaW5nLCByZXNvbHZlcjogKCkgPT4gUHJvbWlzZTxBPikge1xuICAgIC8vIHRyeSB0byBnZXQgYWNjb3VudCBJRCBiYXNlZCBvbiB0aGlzIGFjY2VzcyBrZXkgSUQgZnJvbSBkaXNrLlxuICAgIGNvbnN0IGNhY2hlZCA9IGF3YWl0IHRoaXMuZ2V0KGFjY2Vzc0tleUlkKTtcbiAgICBpZiAoY2FjaGVkKSB7XG4gICAgICBhd2FpdCB0aGlzLmRlYnVnKGBSZXRyaWV2ZWQgYWNjb3VudCBJRCAke2NhY2hlZC5hY2NvdW50SWR9IGZyb20gZGlzayBjYWNoZWApO1xuICAgICAgcmV0dXJuIGNhY2hlZDtcbiAgICB9XG5cbiAgICAvLyBpZiBpdCdzIG5vdCBpbiB0aGUgY2FjaGUsIHJlc29sdmUgYW5kIHB1dCBpbiBjYWNoZS5cbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgcmVzb2x2ZXIoKTtcbiAgICBpZiAoYWNjb3VudCkge1xuICAgICAgYXdhaXQgdGhpcy5wdXQoYWNjZXNzS2V5SWQsIGFjY291bnQpO1xuICAgIH1cblxuICAgIHJldHVybiBhY2NvdW50O1xuICB9XG5cbiAgLyoqIEdldCB0aGUgYWNjb3VudCBJRCBmcm9tIGFuIGFjY2VzcyBrZXkgb3IgdW5kZWZpbmVkIGlmIG5vdCBpbiBjYWNoZSAqL1xuICBwdWJsaWMgYXN5bmMgZ2V0KGFjY2Vzc0tleUlkOiBzdHJpbmcpOiBQcm9taXNlPEFjY291bnQgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCBtYXAgPSBhd2FpdCB0aGlzLmxvYWRNYXAoKTtcbiAgICByZXR1cm4gbWFwW2FjY2Vzc0tleUlkXTtcbiAgfVxuXG4gIC8qKiBQdXQgYSBtYXBwaW5nIGJldHdlZW4gYWNjZXNzIGtleSBhbmQgYWNjb3VudCBJRCAqL1xuICBwdWJsaWMgYXN5bmMgcHV0KGFjY2Vzc0tleUlkOiBzdHJpbmcsIGFjY291bnQ6IEFjY291bnQpIHtcbiAgICBsZXQgbWFwID0gYXdhaXQgdGhpcy5sb2FkTWFwKCk7XG5cbiAgICAvLyBudWtlIGNhY2hlIGlmIGl0J3MgdG9vIGJpZy5cbiAgICBpZiAoT2JqZWN0LmtleXMobWFwKS5sZW5ndGggPj0gQWNjb3VudEFjY2Vzc0tleUNhY2hlLk1BWF9FTlRSSUVTKSB7XG4gICAgICBtYXAgPSB7fTtcbiAgICB9XG5cbiAgICBtYXBbYWNjZXNzS2V5SWRdID0gYWNjb3VudDtcbiAgICBhd2FpdCB0aGlzLnNhdmVNYXAobWFwKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbG9hZE1hcCgpOiBQcm9taXNlPHsgW2FjY2Vzc0tleUlkOiBzdHJpbmddOiBBY2NvdW50IH0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGZzLnJlYWRKc29uKHRoaXMuY2FjaGVGaWxlKTtcbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCBvciBpcyBub3QgcmVhZGFibGUuIFRoaXMgaXMgYSBjYWNoZSxcbiAgICAgIC8vIHByZXRlbmQgd2Ugc3VjY2Vzc2Z1bGx5IGxvYWRlZCBhbiBlbXB0eSBtYXAuXG4gICAgICBpZiAoZS5jb2RlID09PSAnRU5PRU5UJyB8fCBlLmNvZGUgPT09ICdFQUNDRVMnKSB7XG4gICAgICAgIHJldHVybiB7fTtcbiAgICAgIH1cbiAgICAgIC8vIEZpbGUgaXMgbm90IEpTT04sIGNvdWxkIGJlIGNvcnJ1cHRlZCBiZWNhdXNlIG9mIGNvbmN1cnJlbnQgd3JpdGVzLlxuICAgICAgLy8gQWdhaW4sIGFuIGVtcHR5IGNhY2hlIGlzIGZpbmUuXG4gICAgICBpZiAoZSBpbnN0YW5jZW9mIFN5bnRheEVycm9yKSB7XG4gICAgICAgIHJldHVybiB7fTtcbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzYXZlTWFwKG1hcDogeyBbYWNjZXNzS2V5SWQ6IHN0cmluZ106IEFjY291bnQgfSkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmcy5lbnN1cmVGaWxlKHRoaXMuY2FjaGVGaWxlKTtcbiAgICAgIGF3YWl0IGZzLndyaXRlSnNvbih0aGlzLmNhY2hlRmlsZSwgbWFwLCB7IHNwYWNlczogMiB9KTtcbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCBvciBmaWxlL2RpciBpc24ndCB3cml0YWJsZS4gVGhpcyBpcyBhIGNhY2hlLFxuICAgICAgLy8gaWYgd2UgY2FuJ3Qgd3JpdGUgaXQgdGhlbiB0b28gYmFkLlxuICAgICAgaWYgKGUuY29kZSA9PT0gJ0VOT0VOVCcgfHwgZS5jb2RlID09PSAnRUFDQ0VTJyB8fCBlLmNvZGUgPT09ICdFUk9GUycpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==