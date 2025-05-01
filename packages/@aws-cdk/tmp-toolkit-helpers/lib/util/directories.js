"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cdkHomeDir = cdkHomeDir;
exports.cdkCacheDir = cdkCacheDir;
exports.bundledPackageRootDir = bundledPackageRootDir;
const fs = require("fs");
const os = require("os");
const path = require("path");
const toolkit_error_1 = require("../api/toolkit-error");
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
function cdkHomeDir() {
    const tmpDir = fs.realpathSync(os.tmpdir());
    let home;
    try {
        let userInfoHome = os.userInfo().homedir;
        // Node returns this if the user doesn't have a home directory
        /* c8 ignore start */ // will not happen in normal setups
        if (userInfoHome == '/var/empty') {
            userInfoHome = undefined;
        }
        /* c8 ignore stop */
        home = path.join((userInfoHome ?? os.homedir()).trim(), '.cdk');
    }
    catch {
    }
    return process.env.CDK_HOME
        ? path.resolve(process.env.CDK_HOME)
        : home || fs.mkdtempSync(path.join(tmpDir, '.cdk')).trim();
}
function cdkCacheDir() {
    return path.join(cdkHomeDir(), 'cache');
}
function bundledPackageRootDir(start, fail) {
    function _rootDir(dirname) {
        const manifestPath = path.join(dirname, 'package.json');
        if (fs.existsSync(manifestPath)) {
            return dirname;
        }
        if (path.dirname(dirname) === dirname) {
            if (fail ?? true) {
                throw new toolkit_error_1.ToolkitError('Unable to find package manifest');
            }
            return undefined;
        }
        return _rootDir(path.dirname(dirname));
    }
    return _rootDir(start);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlyZWN0b3JpZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvdXRpbC9kaXJlY3Rvcmllcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQWdCQSxnQ0FpQkM7QUFFRCxrQ0FFQztBQVdELHNEQWdCQztBQWhFRCx5QkFBeUI7QUFDekIseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3Qix3REFBb0Q7QUFFcEQ7Ozs7Ozs7Ozs7R0FVRztBQUNILFNBQWdCLFVBQVU7SUFDeEIsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztJQUM1QyxJQUFJLElBQUksQ0FBQztJQUNULElBQUksQ0FBQztRQUNILElBQUksWUFBWSxHQUF1QixFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsT0FBTyxDQUFDO1FBQzdELDhEQUE4RDtRQUM5RCxxQkFBcUIsQ0FBQyxtQ0FBbUM7UUFDekQsSUFBSSxZQUFZLElBQUksWUFBWSxFQUFFLENBQUM7WUFDakMsWUFBWSxHQUFHLFNBQVMsQ0FBQztRQUMzQixDQUFDO1FBQ0Qsb0JBQW9CO1FBQ3BCLElBQUksR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsWUFBWSxJQUFJLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ2xFLENBQUM7SUFBQyxNQUFNLENBQUM7SUFDVCxDQUFDO0lBQ0QsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVE7UUFDekIsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUM7UUFDcEMsQ0FBQyxDQUFDLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7QUFDL0QsQ0FBQztBQUVELFNBQWdCLFdBQVc7SUFDekIsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0FBQzFDLENBQUM7QUFXRCxTQUFnQixxQkFBcUIsQ0FBQyxLQUFhLEVBQUUsSUFBYztJQUNqRSxTQUFTLFFBQVEsQ0FBQyxPQUFlO1FBQy9CLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLGNBQWMsQ0FBQyxDQUFDO1FBQ3hELElBQUksRUFBRSxDQUFDLFVBQVUsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO1lBQ2hDLE9BQU8sT0FBTyxDQUFDO1FBQ2pCLENBQUM7UUFDRCxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEtBQUssT0FBTyxFQUFFLENBQUM7WUFDdEMsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sSUFBSSw0QkFBWSxDQUFDLGlDQUFpQyxDQUFDLENBQUM7WUFDNUQsQ0FBQztZQUNELE9BQU8sU0FBUyxDQUFDO1FBQ25CLENBQUM7UUFDRCxPQUFPLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7SUFDekMsQ0FBQztJQUVELE9BQU8sUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ3pCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdvcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgVG9vbGtpdEVycm9yIH0gZnJvbSAnLi4vYXBpL3Rvb2xraXQtZXJyb3InO1xuXG4vKipcbiAqIFJldHVybiBhIGxvY2F0aW9uIHRoYXQgd2lsbCBiZSB1c2VkIGFzIHRoZSBDREsgaG9tZSBkaXJlY3RvcnkuXG4gKiBDdXJyZW50bHkgdGhlIG9ubHkgdGhpbmcgdGhhdCBpcyBwbGFjZWQgaGVyZSBpcyB0aGUgY2FjaGUuXG4gKlxuICogRmlyc3QgdHJ5IHRvIHVzZSB0aGUgdXNlcnMgaG9tZSBkaXJlY3RvcnkgKGkuZS4gL2hvbWUvc29tZXVzZXIvKSxcbiAqIGJ1dCBpZiB0aGF0IGRpcmVjdG9yeSBkb2VzIG5vdCBleGlzdCBmb3Igc29tZSByZWFzb24gY3JlYXRlIGEgdG1wIGRpcmVjdG9yeS5cbiAqXG4gKiBUeXBpY2FsbHkgaXQgd291bGRuJ3QgbWFrZSBzZW5zZSB0byBjcmVhdGUgYSBvbmUgdGltZSB1c2UgdG1wIGRpcmVjdG9yeSBmb3JcbiAqIHRoZSBwdXJwb3NlIG9mIGNyZWF0aW5nIGEgY2FjaGUsIGJ1dCBzaW5jZSB0aGlzIG9ubHkgYXBwbGllcyB0byB1c2VycyB0aGF0IGRvXG4gKiBub3QgaGF2ZSBhIGhvbWUgZGlyZWN0b3J5IChzb21lIENJIHN5c3RlbXM/KSB0aGlzIHNob3VsZCBiZSBmaW5lLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2RrSG9tZURpcigpIHtcbiAgY29uc3QgdG1wRGlyID0gZnMucmVhbHBhdGhTeW5jKG9zLnRtcGRpcigpKTtcbiAgbGV0IGhvbWU7XG4gIHRyeSB7XG4gICAgbGV0IHVzZXJJbmZvSG9tZTogc3RyaW5nIHwgdW5kZWZpbmVkID0gb3MudXNlckluZm8oKS5ob21lZGlyO1xuICAgIC8vIE5vZGUgcmV0dXJucyB0aGlzIGlmIHRoZSB1c2VyIGRvZXNuJ3QgaGF2ZSBhIGhvbWUgZGlyZWN0b3J5XG4gICAgLyogYzggaWdub3JlIHN0YXJ0ICovIC8vIHdpbGwgbm90IGhhcHBlbiBpbiBub3JtYWwgc2V0dXBzXG4gICAgaWYgKHVzZXJJbmZvSG9tZSA9PSAnL3Zhci9lbXB0eScpIHtcbiAgICAgIHVzZXJJbmZvSG9tZSA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgLyogYzggaWdub3JlIHN0b3AgKi9cbiAgICBob21lID0gcGF0aC5qb2luKCh1c2VySW5mb0hvbWUgPz8gb3MuaG9tZWRpcigpKS50cmltKCksICcuY2RrJyk7XG4gIH0gY2F0Y2gge1xuICB9XG4gIHJldHVybiBwcm9jZXNzLmVudi5DREtfSE9NRVxuICAgID8gcGF0aC5yZXNvbHZlKHByb2Nlc3MuZW52LkNES19IT01FKVxuICAgIDogaG9tZSB8fCBmcy5ta2R0ZW1wU3luYyhwYXRoLmpvaW4odG1wRGlyLCAnLmNkaycpKS50cmltKCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjZGtDYWNoZURpcigpIHtcbiAgcmV0dXJuIHBhdGguam9pbihjZGtIb21lRGlyKCksICdjYWNoZScpO1xufVxuXG4vKipcbiAqIEZyb20gdGhlIHN0YXJ0IGxvY2F0aW9uLCBmaW5kIHRoZSBkaXJlY3RvcnkgdGhhdCBjb250YWlucyB0aGUgYnVuZGxlZCBwYWNrYWdlJ3MgcGFja2FnZS5qc29uXG4gKlxuICogWW91IG11c3QgYXNzdW1lIHRoZSBjYWxsZXIgb2YgdGhpcyBmdW5jdGlvbiB3aWxsIGJlIGJ1bmRsZWQgYW5kIHRoZSBwYWNrYWdlIHJvb3QgZGlyXG4gKiBpcyBub3QgZ29pbmcgdG8gYmUgdGhlIHNhbWUgYXMgdGhlIHBhY2thZ2UgdGhlIGNhbGxlciBjdXJyZW50bHkgbGl2ZXMgaW4uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidW5kbGVkUGFja2FnZVJvb3REaXIoc3RhcnQ6IHN0cmluZyk6IHN0cmluZztcbmV4cG9ydCBmdW5jdGlvbiBidW5kbGVkUGFja2FnZVJvb3REaXIoc3RhcnQ6IHN0cmluZywgZmFpbDogdHJ1ZSk6IHN0cmluZztcbmV4cG9ydCBmdW5jdGlvbiBidW5kbGVkUGFja2FnZVJvb3REaXIoc3RhcnQ6IHN0cmluZywgZmFpbDogZmFsc2UpOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5leHBvcnQgZnVuY3Rpb24gYnVuZGxlZFBhY2thZ2VSb290RGlyKHN0YXJ0OiBzdHJpbmcsIGZhaWw/OiBib29sZWFuKSB7XG4gIGZ1bmN0aW9uIF9yb290RGlyKGRpcm5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgbWFuaWZlc3RQYXRoID0gcGF0aC5qb2luKGRpcm5hbWUsICdwYWNrYWdlLmpzb24nKTtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhtYW5pZmVzdFBhdGgpKSB7XG4gICAgICByZXR1cm4gZGlybmFtZTtcbiAgICB9XG4gICAgaWYgKHBhdGguZGlybmFtZShkaXJuYW1lKSA9PT0gZGlybmFtZSkge1xuICAgICAgaWYgKGZhaWwgPz8gdHJ1ZSkge1xuICAgICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKCdVbmFibGUgdG8gZmluZCBwYWNrYWdlIG1hbmlmZXN0Jyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICByZXR1cm4gX3Jvb3REaXIocGF0aC5kaXJuYW1lKGRpcm5hbWUpKTtcbiAgfVxuXG4gIHJldHVybiBfcm9vdERpcihzdGFydCk7XG59XG4iXX0=