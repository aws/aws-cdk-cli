"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegManifestReader = void 0;
const path = require("path");
const cloud_assembly_schema_1 = require("@aws-cdk/cloud-assembly-schema");
const fs = require("fs-extra");
/**
 * Reads an integration tests manifest
 */
class IntegManifestReader {
    /**
     * Reads an integration test manifest from the specified file
     */
    static fromFile(fileName) {
        try {
            const obj = cloud_assembly_schema_1.Manifest.loadIntegManifest(fileName);
            return new IntegManifestReader(path.dirname(fileName), obj);
        }
        catch (e) {
            throw new Error(`Cannot read integ manifest '${fileName}': ${e.message}`);
        }
    }
    /**
     * Reads a Integration test manifest from a file or a directory
     * If the given filePath is a directory then it will look for
     * a file within the directory with the DEFAULT_FILENAME
     */
    static fromPath(filePath) {
        let st;
        try {
            st = fs.statSync(filePath);
        }
        catch (e) {
            throw new Error(`Cannot read integ manifest at '${filePath}': ${e.message}`);
        }
        if (st.isDirectory()) {
            return IntegManifestReader.fromFile(path.join(filePath, IntegManifestReader.DEFAULT_FILENAME));
        }
        return IntegManifestReader.fromFile(filePath);
    }
    constructor(directory, manifest) {
        this.manifest = manifest;
        this.directory = directory;
    }
    /**
     * List of integration tests in the manifest
     */
    get tests() {
        return {
            testCases: this.manifest.testCases,
            enableLookups: this.manifest.enableLookups ?? false,
            synthContext: this.manifest.synthContext,
        };
    }
}
exports.IntegManifestReader = IntegManifestReader;
IntegManifestReader.DEFAULT_FILENAME = 'integ.json';
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW50ZWctbWFuaWZlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbnRlZy1tYW5pZmVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2QkFBNkI7QUFFN0IsMEVBQTBEO0FBQzFELCtCQUErQjtBQTRCL0I7O0dBRUc7QUFDSCxNQUFhLG1CQUFtQjtJQUc5Qjs7T0FFRztJQUNJLE1BQU0sQ0FBQyxRQUFRLENBQUMsUUFBZ0I7UUFDckMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxHQUFHLEdBQUcsZ0NBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUNqRCxPQUFPLElBQUksbUJBQW1CLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUM5RCxDQUFDO1FBQUMsT0FBTyxDQUFNLEVBQUUsQ0FBQztZQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLCtCQUErQixRQUFRLE1BQU0sQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUM7UUFDNUUsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0ksTUFBTSxDQUFDLFFBQVEsQ0FBQyxRQUFnQjtRQUNyQyxJQUFJLEVBQUUsQ0FBQztRQUNQLElBQUksQ0FBQztZQUNILEVBQUUsR0FBRyxFQUFFLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzdCLENBQUM7UUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO1lBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsa0NBQWtDLFFBQVEsTUFBTSxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQztRQUMvRSxDQUFDO1FBQ0QsSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUNyQixPQUFPLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxtQkFBbUIsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUM7UUFDakcsQ0FBQztRQUNELE9BQU8sbUJBQW1CLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ2hELENBQUM7SUFNRCxZQUFZLFNBQWlCLEVBQW1CLFFBQXVCO1FBQXZCLGFBQVEsR0FBUixRQUFRLENBQWU7UUFDckUsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7SUFDN0IsQ0FBQztJQUVEOztPQUVHO0lBQ0gsSUFBVyxLQUFLO1FBQ2QsT0FBTztZQUNMLFNBQVMsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVM7WUFDbEMsYUFBYSxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsYUFBYSxJQUFJLEtBQUs7WUFDbkQsWUFBWSxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWTtTQUN6QyxDQUFDO0lBQ0osQ0FBQzs7QUFsREgsa0RBbURDO0FBbER3QixvQ0FBZ0IsR0FBRyxZQUFZLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHR5cGUgeyBJbnRlZ01hbmlmZXN0LCBUZXN0Q2FzZSB9IGZyb20gJ0Bhd3MtY2RrL2Nsb3VkLWFzc2VtYmx5LXNjaGVtYSc7XG5pbXBvcnQgeyBNYW5pZmVzdCB9IGZyb20gJ0Bhd3MtY2RrL2Nsb3VkLWFzc2VtYmx5LXNjaGVtYSc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcy1leHRyYSc7XG5cbi8qKlxuICogVGVzdCBjYXNlIGNvbmZpZ3VyYXRpb24gcmVhZCBmcm9tIHRoZSBpbnRlZyBtYW5pZmVzdFxuICovXG5leHBvcnQgaW50ZXJmYWNlIEludGVnVGVzdENvbmZpZyB7XG4gIC8qKlxuICAgKiBUZXN0IGNhc2VzIGNvbnRhaW5lZCBpbiB0aGlzIGludGVncmF0aW9uIHRlc3RcbiAgICovXG4gIHJlYWRvbmx5IHRlc3RDYXNlczogeyBbdGVzdENhc2VOYW1lOiBzdHJpbmddOiBUZXN0Q2FzZSB9O1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGVuYWJsZSBsb29rdXBzIGZvciB0aGlzIHRlc3RcbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IGVuYWJsZUxvb2t1cHM6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIEFkZGl0aW9uYWwgY29udGV4dCB0byB1c2Ugd2hlbiBwZXJmb3JtaW5nXG4gICAqIGEgc3ludGguIEFueSBjb250ZXh0IHByb3ZpZGVkIGhlcmUgd2lsbCBvdmVycmlkZVxuICAgKiBhbnkgZGVmYXVsdCBjb250ZXh0XG4gICAqXG4gICAqIEBkZWZhdWx0IC0gbm8gYWRkaXRpb25hbCBjb250ZXh0XG4gICAqL1xuICByZWFkb25seSBzeW50aENvbnRleHQ/OiB7IFtuYW1lOiBzdHJpbmddOiBzdHJpbmcgfTtcbn1cblxuLyoqXG4gKiBSZWFkcyBhbiBpbnRlZ3JhdGlvbiB0ZXN0cyBtYW5pZmVzdFxuICovXG5leHBvcnQgY2xhc3MgSW50ZWdNYW5pZmVzdFJlYWRlciB7XG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgREVGQVVMVF9GSUxFTkFNRSA9ICdpbnRlZy5qc29uJztcblxuICAvKipcbiAgICogUmVhZHMgYW4gaW50ZWdyYXRpb24gdGVzdCBtYW5pZmVzdCBmcm9tIHRoZSBzcGVjaWZpZWQgZmlsZVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tRmlsZShmaWxlTmFtZTogc3RyaW5nKTogSW50ZWdNYW5pZmVzdFJlYWRlciB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG9iaiA9IE1hbmlmZXN0LmxvYWRJbnRlZ01hbmlmZXN0KGZpbGVOYW1lKTtcbiAgICAgIHJldHVybiBuZXcgSW50ZWdNYW5pZmVzdFJlYWRlcihwYXRoLmRpcm5hbWUoZmlsZU5hbWUpLCBvYmopO1xuICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmVhZCBpbnRlZyBtYW5pZmVzdCAnJHtmaWxlTmFtZX0nOiAke2UubWVzc2FnZX1gKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBJbnRlZ3JhdGlvbiB0ZXN0IG1hbmlmZXN0IGZyb20gYSBmaWxlIG9yIGEgZGlyZWN0b3J5XG4gICAqIElmIHRoZSBnaXZlbiBmaWxlUGF0aCBpcyBhIGRpcmVjdG9yeSB0aGVuIGl0IHdpbGwgbG9vayBmb3JcbiAgICogYSBmaWxlIHdpdGhpbiB0aGUgZGlyZWN0b3J5IHdpdGggdGhlIERFRkFVTFRfRklMRU5BTUVcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZnJvbVBhdGgoZmlsZVBhdGg6IHN0cmluZyk6IEludGVnTWFuaWZlc3RSZWFkZXIge1xuICAgIGxldCBzdDtcbiAgICB0cnkge1xuICAgICAgc3QgPSBmcy5zdGF0U3luYyhmaWxlUGF0aCk7XG4gICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZWFkIGludGVnIG1hbmlmZXN0IGF0ICcke2ZpbGVQYXRofSc6ICR7ZS5tZXNzYWdlfWApO1xuICAgIH1cbiAgICBpZiAoc3QuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgcmV0dXJuIEludGVnTWFuaWZlc3RSZWFkZXIuZnJvbUZpbGUocGF0aC5qb2luKGZpbGVQYXRoLCBJbnRlZ01hbmlmZXN0UmVhZGVyLkRFRkFVTFRfRklMRU5BTUUpKTtcbiAgICB9XG4gICAgcmV0dXJuIEludGVnTWFuaWZlc3RSZWFkZXIuZnJvbUZpbGUoZmlsZVBhdGgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBkaXJlY3Rvcnkgd2hlcmUgdGhlIG1hbmlmZXN0IHdhcyBmb3VuZFxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGRpcmVjdG9yeTogc3RyaW5nO1xuICBjb25zdHJ1Y3RvcihkaXJlY3Rvcnk6IHN0cmluZywgcHJpdmF0ZSByZWFkb25seSBtYW5pZmVzdDogSW50ZWdNYW5pZmVzdCkge1xuICAgIHRoaXMuZGlyZWN0b3J5ID0gZGlyZWN0b3J5O1xuICB9XG5cbiAgLyoqXG4gICAqIExpc3Qgb2YgaW50ZWdyYXRpb24gdGVzdHMgaW4gdGhlIG1hbmlmZXN0XG4gICAqL1xuICBwdWJsaWMgZ2V0IHRlc3RzKCk6IEludGVnVGVzdENvbmZpZyB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHRlc3RDYXNlczogdGhpcy5tYW5pZmVzdC50ZXN0Q2FzZXMsXG4gICAgICBlbmFibGVMb29rdXBzOiB0aGlzLm1hbmlmZXN0LmVuYWJsZUxvb2t1cHMgPz8gZmFsc2UsXG4gICAgICBzeW50aENvbnRleHQ6IHRoaXMubWFuaWZlc3Quc3ludGhDb250ZXh0LFxuICAgIH07XG4gIH1cbn1cbiJdfQ==