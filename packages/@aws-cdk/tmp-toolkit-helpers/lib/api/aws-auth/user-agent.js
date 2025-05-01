"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultCliUserAgent = defaultCliUserAgent;
const path = require("path");
const util_1 = require("./util");
const util_2 = require("../../util");
/**
 * Find the package.json from the main toolkit.
 *
 * If we can't read it for some reason, try to do something reasonable anyway.
 * Fall back to argv[1], or a standard string if that is undefined for some reason.
 */
function defaultCliUserAgent() {
    const root = (0, util_2.bundledPackageRootDir)(__dirname, false);
    const pkg = JSON.parse((root ? (0, util_1.readIfPossible)(path.join(root, 'package.json')) : undefined) ?? '{}');
    const name = pkg.name ?? path.basename(process.argv[1] ?? 'cdk-cli');
    const version = pkg.version ?? '<unknown>';
    return `${name}/${version}`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXNlci1hZ2VudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvYXdzLWF1dGgvdXNlci1hZ2VudC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQVNBLGtEQU1DO0FBZkQsNkJBQTZCO0FBQzdCLGlDQUF3QztBQUN4QyxxQ0FBbUQ7QUFDbkQ7Ozs7O0dBS0c7QUFDSCxTQUFnQixtQkFBbUI7SUFDakMsTUFBTSxJQUFJLEdBQUcsSUFBQSw0QkFBcUIsRUFBQyxTQUFTLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDckQsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBQSxxQkFBYyxFQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDO0lBQ3JHLE1BQU0sSUFBSSxHQUFHLEdBQUcsQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLFNBQVMsQ0FBQyxDQUFDO0lBQ3JFLE1BQU0sT0FBTyxHQUFHLEdBQUcsQ0FBQyxPQUFPLElBQUksV0FBVyxDQUFDO0lBQzNDLE9BQU8sR0FBRyxJQUFJLElBQUksT0FBTyxFQUFFLENBQUM7QUFDOUIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyByZWFkSWZQb3NzaWJsZSB9IGZyb20gJy4vdXRpbCc7XG5pbXBvcnQgeyBidW5kbGVkUGFja2FnZVJvb3REaXIgfSBmcm9tICcuLi8uLi91dGlsJztcbi8qKlxuICogRmluZCB0aGUgcGFja2FnZS5qc29uIGZyb20gdGhlIG1haW4gdG9vbGtpdC5cbiAqXG4gKiBJZiB3ZSBjYW4ndCByZWFkIGl0IGZvciBzb21lIHJlYXNvbiwgdHJ5IHRvIGRvIHNvbWV0aGluZyByZWFzb25hYmxlIGFueXdheS5cbiAqIEZhbGwgYmFjayB0byBhcmd2WzFdLCBvciBhIHN0YW5kYXJkIHN0cmluZyBpZiB0aGF0IGlzIHVuZGVmaW5lZCBmb3Igc29tZSByZWFzb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0Q2xpVXNlckFnZW50KCkge1xuICBjb25zdCByb290ID0gYnVuZGxlZFBhY2thZ2VSb290RGlyKF9fZGlybmFtZSwgZmFsc2UpO1xuICBjb25zdCBwa2cgPSBKU09OLnBhcnNlKChyb290ID8gcmVhZElmUG9zc2libGUocGF0aC5qb2luKHJvb3QsICdwYWNrYWdlLmpzb24nKSkgOiB1bmRlZmluZWQpID8/ICd7fScpO1xuICBjb25zdCBuYW1lID0gcGtnLm5hbWUgPz8gcGF0aC5iYXNlbmFtZShwcm9jZXNzLmFyZ3ZbMV0gPz8gJ2Nkay1jbGknKTtcbiAgY29uc3QgdmVyc2lvbiA9IHBrZy52ZXJzaW9uID8/ICc8dW5rbm93bj4nO1xuICByZXR1cm4gYCR7bmFtZX0vJHt2ZXJzaW9ufWA7XG59XG4iXX0=