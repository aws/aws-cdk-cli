"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LegacyIntegTestSuite = exports.IntegTestSuite = void 0;
const osPath = require("path");
const cloud_assembly_schema_1 = require("@aws-cdk/cloud-assembly-schema");
const fs = require("fs-extra");
const integ_manifest_1 = require("./private/integ-manifest");
const CDK_INTEG_STACK_PRAGMA = '/// !cdk-integ';
const PRAGMA_PREFIX = 'pragma:';
const SET_CONTEXT_PRAGMA_PREFIX = 'pragma:set-context:';
const VERIFY_ASSET_HASHES = 'pragma:include-assets-hashes';
const DISABLE_UPDATE_WORKFLOW = 'pragma:disable-update-workflow';
const ENABLE_LOOKUPS_PRAGMA = 'pragma:enable-lookups';
/**
 * Helper class for working with Integration tests
 * This requires an `integ.json` file in the snapshot
 * directory. For legacy test cases use LegacyIntegTestCases
 */
class IntegTestSuite {
    /**
     * Loads integ tests from a snapshot directory
     */
    static fromPath(path) {
        const reader = integ_manifest_1.IntegManifestReader.fromPath(path);
        return new IntegTestSuite(reader.tests.enableLookups, reader.tests.testCases, reader.tests.synthContext);
    }
    constructor(enableLookups, testSuite, synthContext) {
        this.enableLookups = enableLookups;
        this.testSuite = testSuite;
        this.synthContext = synthContext;
        this.type = 'test-suite';
    }
    /**
     * Returns a list of stacks that have stackUpdateWorkflow disabled
     */
    getStacksWithoutUpdateWorkflow() {
        return Object.values(this.testSuite)
            .filter(testCase => !(testCase.stackUpdateWorkflow ?? true))
            .flatMap((testCase) => testCase.stacks);
    }
    /**
     * Returns test case options for a given stack
     */
    getOptionsForStack(stackId) {
        for (const testCase of Object.values(this.testSuite ?? {})) {
            if (testCase.stacks.includes(stackId)) {
                return {
                    hooks: testCase.hooks,
                    regions: testCase.regions,
                    diffAssets: testCase.diffAssets ?? false,
                    allowDestroy: testCase.allowDestroy,
                    cdkCommandOptions: testCase.cdkCommandOptions,
                    stackUpdateWorkflow: testCase.stackUpdateWorkflow ?? true,
                };
            }
        }
        return undefined;
    }
    /**
     * Get a list of stacks in the test suite
     */
    get stacks() {
        return Object.values(this.testSuite).flatMap(testCase => testCase.stacks);
    }
}
exports.IntegTestSuite = IntegTestSuite;
/**
 * Helper class for creating an integ manifest for legacy
 * test cases, i.e. tests without a `integ.json`.
 */
class LegacyIntegTestSuite extends IntegTestSuite {
    /**
     * Returns the single test stack to use.
     *
     * If the test has a single stack, it will be chosen. Otherwise a pragma is expected within the
     * test file the name of the stack:
     *
     * @example
     *
     *    /// !cdk-integ <stack-name>
     *
     */
    static fromLegacy(config) {
        const pragmas = this.pragmas(config.integSourceFilePath);
        const tests = {
            stacks: [],
            diffAssets: pragmas.includes(VERIFY_ASSET_HASHES),
            stackUpdateWorkflow: !pragmas.includes(DISABLE_UPDATE_WORKFLOW),
        };
        const pragma = this.readStackPragma(config.integSourceFilePath);
        if (pragma.length > 0) {
            tests.stacks.push(...pragma);
        }
        else {
            const options = {
                ...config.listOptions,
                notices: false,
            };
            const stacks = (config.cdk.list(options)).split('\n');
            if (stacks.length !== 1) {
                throw new Error('"cdk-integ" can only operate on apps with a single stack.\n\n' +
                    '  If your app has multiple stacks, specify which stack to select by adding this to your test source:\n\n' +
                    `      ${CDK_INTEG_STACK_PRAGMA} STACK ...\n\n` +
                    `  Available stacks: ${stacks.join(' ')} (wildcards are also supported)\n`);
            }
            if (stacks.length === 1 && stacks[0] === '') {
                throw new Error(`No stack found for test ${config.testName}`);
            }
            tests.stacks.push(...stacks);
        }
        return new LegacyIntegTestSuite(pragmas.includes(ENABLE_LOOKUPS_PRAGMA), {
            [config.testName]: tests,
        }, LegacyIntegTestSuite.getPragmaContext(config.integSourceFilePath));
    }
    static getPragmaContext(integSourceFilePath) {
        const ctxPragmaContext = {};
        // apply context from set-context pragma
        // usage: pragma:set-context:key=value
        const ctxPragmas = (this.pragmas(integSourceFilePath)).filter(p => p.startsWith(SET_CONTEXT_PRAGMA_PREFIX));
        for (const p of ctxPragmas) {
            const instruction = p.substring(SET_CONTEXT_PRAGMA_PREFIX.length);
            const [key, value] = instruction.split('=');
            if (key == null || value == null) {
                throw new Error(`invalid "set-context" pragma syntax. example: "pragma:set-context:@aws-cdk/core:newStyleStackSynthesis=true" got: ${p}`);
            }
            ctxPragmaContext[key] = value;
        }
        return {
            ...ctxPragmaContext,
        };
    }
    /**
     * Reads stack names from the "!cdk-integ" pragma.
     *
     * Every word that's NOT prefixed by "pragma:" is considered a stack name.
     *
     * @example
     *
     *    /// !cdk-integ <stack-name>
     */
    static readStackPragma(integSourceFilePath) {
        return (this.readIntegPragma(integSourceFilePath)).filter(p => !p.startsWith(PRAGMA_PREFIX));
    }
    /**
     * Read arbitrary cdk-integ pragma directives
     *
     * Reads the test source file and looks for the "!cdk-integ" pragma. If it exists, returns it's
     * contents. This allows integ tests to supply custom command line arguments to "cdk deploy" and "cdk synth".
     *
     * @example
     *
     *    /// !cdk-integ [...]
     */
    static readIntegPragma(integSourceFilePath) {
        const source = fs.readFileSync(integSourceFilePath, { encoding: 'utf-8' });
        const pragmaLine = source.split('\n').find(x => x.startsWith(CDK_INTEG_STACK_PRAGMA + ' '));
        if (!pragmaLine) {
            return [];
        }
        const args = pragmaLine.substring(CDK_INTEG_STACK_PRAGMA.length).trim().split(' ');
        if (args.length === 0) {
            throw new Error(`Invalid syntax for cdk-integ pragma. Usage: "${CDK_INTEG_STACK_PRAGMA} [STACK] [pragma:PRAGMA] [...]"`);
        }
        return args;
    }
    /**
     * Return the non-stack pragmas
     *
     * These are all pragmas that start with "pragma:".
     *
     * For backwards compatibility reasons, all pragmas that DON'T start with this
     * string are considered to be stack names.
     */
    static pragmas(integSourceFilePath) {
        return (this.readIntegPragma(integSourceFilePath)).filter(p => p.startsWith(PRAGMA_PREFIX));
    }
    constructor(enableLookups, testSuite, synthContext) {
        super(enableLookups, testSuite);
        this.enableLookups = enableLookups;
        this.testSuite = testSuite;
        this.synthContext = synthContext;
        this.type = 'legacy-test-suite';
    }
    /**
     * Save the integ manifest to a directory
     */
    saveManifest(directory, context) {
        const manifest = {
            version: cloud_assembly_schema_1.Manifest.version(),
            testCases: this.testSuite,
            synthContext: context,
            enableLookups: this.enableLookups,
        };
        cloud_assembly_schema_1.Manifest.saveIntegManifest(manifest, osPath.join(directory, integ_manifest_1.IntegManifestReader.DEFAULT_FILENAME));
    }
}
exports.LegacyIntegTestSuite = LegacyIntegTestSuite;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW50ZWctdGVzdC1zdWl0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImludGVnLXRlc3Qtc3VpdGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsK0JBQStCO0FBRy9CLDBFQUEwRDtBQUMxRCwrQkFBK0I7QUFDL0IsNkRBQStEO0FBRS9ELE1BQU0sc0JBQXNCLEdBQUcsZ0JBQWdCLENBQUM7QUFDaEQsTUFBTSxhQUFhLEdBQUcsU0FBUyxDQUFDO0FBQ2hDLE1BQU0seUJBQXlCLEdBQUcscUJBQXFCLENBQUM7QUFDeEQsTUFBTSxtQkFBbUIsR0FBRyw4QkFBOEIsQ0FBQztBQUMzRCxNQUFNLHVCQUF1QixHQUFHLGdDQUFnQyxDQUFDO0FBQ2pFLE1BQU0scUJBQXFCLEdBQUcsdUJBQXVCLENBQUM7QUFTdEQ7Ozs7R0FJRztBQUNILE1BQWEsY0FBYztJQUN6Qjs7T0FFRztJQUNJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBWTtRQUNqQyxNQUFNLE1BQU0sR0FBRyxvQ0FBbUIsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDbEQsT0FBTyxJQUFJLGNBQWMsQ0FDdkIsTUFBTSxDQUFDLEtBQUssQ0FBQyxhQUFhLEVBQzFCLE1BQU0sQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUN0QixNQUFNLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FDMUIsQ0FBQztJQUNKLENBQUM7SUFJRCxZQUNrQixhQUFzQixFQUN0QixTQUFvQixFQUNwQixZQUF5QztRQUZ6QyxrQkFBYSxHQUFiLGFBQWEsQ0FBUztRQUN0QixjQUFTLEdBQVQsU0FBUyxDQUFXO1FBQ3BCLGlCQUFZLEdBQVosWUFBWSxDQUE2QjtRQUwzQyxTQUFJLEdBQWtCLFlBQVksQ0FBQztJQU9uRCxDQUFDO0lBRUQ7O09BRUc7SUFDSSw4QkFBOEI7UUFDbkMsT0FBTyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7YUFDakMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxF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QUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQztJQUM5RixDQUFDO0lBSUQsWUFDa0IsYUFBc0IsRUFDdEIsU0FBb0IsRUFDcEIsWUFBeUM7UUFFekQsS0FBSyxDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUpoQixrQkFBYSxHQUFiLGFBQWEsQ0FBUztRQUN0QixjQUFTLEdBQVQsU0FBUyxDQUFXO1FBQ3BCLGlCQUFZLEdBQVosWUFBWSxDQUE2QjtRQUwzQyxTQUFJLEdBQWtCLG1CQUFtQixDQUFDO0lBUTFELENBQUM7SUFFRDs7T0FFRztJQUNJLFlBQVksQ0FBQyxTQUFpQixFQUFFLE9BQTZCO1FBQ2xFLE1BQU0sUUFBUSxHQUFrQjtZQUM5QixPQUFPLEVBQUUsZ0NBQVEsQ0FBQyxPQUFPLEVBQUU7WUFDM0IsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTO1lBQ3pCLFlBQVksRUFBRSxPQUFPO1lBQ3JCLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtTQUNsQyxDQUFDO1FBQ0YsZ0NBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsb0NBQW1CLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDO0lBQ3JHLENBQUM7Q0FDRjtBQTVJRCxvREE0SUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBvc1BhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgdHlwZSB7IElDZGssIExpc3RPcHRpb25zIH0gZnJvbSAnQGF3cy1jZGsvY2RrLWNsaS13cmFwcGVyJztcbmltcG9ydCB0eXBlIHsgVGVzdENhc2UsIFRlc3RPcHRpb25zLCBJbnRlZ01hbmlmZXN0IH0gZnJvbSAnQGF3cy1jZGsvY2xvdWQtYXNzZW1ibHktc2NoZW1hJztcbmltcG9ydCB7IE1hbmlmZXN0IH0gZnJvbSAnQGF3cy1jZGsvY2xvdWQtYXNzZW1ibHktc2NoZW1hJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzLWV4dHJhJztcbmltcG9ydCB7IEludGVnTWFuaWZlc3RSZWFkZXIgfSBmcm9tICcuL3ByaXZhdGUvaW50ZWctbWFuaWZlc3QnO1xuXG5jb25zdCBDREtfSU5URUdfU1RBQ0tfUFJBR01BID0gJy8vLyAhY2RrLWludGVnJztcbmNvbnN0IFBSQUdNQV9QUkVGSVggPSAncHJhZ21hOic7XG5jb25zdCBTRVRfQ09OVEVYVF9QUkFHTUFfUFJFRklYID0gJ3ByYWdtYTpzZXQtY29udGV4dDonO1xuY29uc3QgVkVSSUZZX0FTU0VUX0hBU0hFUyA9ICdwcmFnbWE6aW5jbHVkZS1hc3NldHMtaGFzaGVzJztcbmNvbnN0IERJU0FCTEVfVVBEQVRFX1dPUktGTE9XID0gJ3ByYWdtYTpkaXNhYmxlLXVwZGF0ZS13b3JrZmxvdyc7XG5jb25zdCBFTkFCTEVfTE9PS1VQU19QUkFHTUEgPSAncHJhZ21hOmVuYWJsZS1sb29rdXBzJztcblxuLyoqXG4gKiBSZXByZXNlbnRzIGFuIGludGVncmF0aW9uIHRlc3RcbiAqL1xuZXhwb3J0IHR5cGUgVGVzdFN1aXRlID0geyBbdGVzdE5hbWU6IHN0cmluZ106IFRlc3RDYXNlIH07XG5cbmV4cG9ydCB0eXBlIFRlc3RTdWl0ZVR5cGUgPSAndGVzdC1zdWl0ZScgfCAnbGVnYWN5LXRlc3Qtc3VpdGUnO1xuXG4vKipcbiAqIEhlbHBlciBjbGFzcyBmb3Igd29ya2luZyB3aXRoIEludGVncmF0aW9uIHRlc3RzXG4gKiBUaGlzIHJlcXVpcmVzIGFuIGBpbnRlZy5qc29uYCBmaWxlIGluIHRoZSBzbmFwc2hvdFxuICogZGlyZWN0b3J5LiBGb3IgbGVnYWN5IHRlc3QgY2FzZXMgdXNlIExlZ2FjeUludGVnVGVzdENhc2VzXG4gKi9cbmV4cG9ydCBjbGFzcyBJbnRlZ1Rlc3RTdWl0ZSB7XG4gIC8qKlxuICAgKiBMb2FkcyBpbnRlZyB0ZXN0cyBmcm9tIGEgc25hcHNob3QgZGlyZWN0b3J5XG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21QYXRoKHBhdGg6IHN0cmluZyk6IEludGVnVGVzdFN1aXRlIHtcbiAgICBjb25zdCByZWFkZXIgPSBJbnRlZ01hbmlmZXN0UmVhZGVyLmZyb21QYXRoKHBhdGgpO1xuICAgIHJldHVybiBuZXcgSW50ZWdUZXN0U3VpdGUoXG4gICAgICByZWFkZXIudGVzdHMuZW5hYmxlTG9va3VwcyxcbiAgICAgIHJlYWRlci50ZXN0cy50ZXN0Q2FzZXMsXG4gICAgICByZWFkZXIudGVzdHMuc3ludGhDb250ZXh0LFxuICAgICk7XG4gIH1cblxuICBwdWJsaWMgcmVhZG9ubHkgdHlwZTogVGVzdFN1aXRlVHlwZSA9ICd0ZXN0LXN1aXRlJztcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwdWJsaWMgcmVhZG9ubHkgZW5hYmxlTG9va3VwczogYm9vbGVhbixcbiAgICBwdWJsaWMgcmVhZG9ubHkgdGVzdFN1aXRlOiBUZXN0U3VpdGUsXG4gICAgcHVibGljIHJlYWRvbmx5IHN5bnRoQ29udGV4dD86IHsgW25hbWU6IHN0cmluZ106IHN0cmluZyB9LFxuICApIHtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgbGlzdCBvZiBzdGFja3MgdGhhdCBoYXZlIHN0YWNrVXBkYXRlV29ya2Zsb3cgZGlzYWJsZWRcbiAgICovXG4gIHB1YmxpYyBnZXRTdGFja3NXaXRob3V0VXBkYXRlV29ya2Zsb3coKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBPYmplY3QudmFsdWVzKHRoaXMudGVzdFN1aXRlKVxuICAgICAgLmZpbHRlcih0ZXN0Q2FzZSA9PiAhKHRlc3RDYXNlLnN0YWNrVXBkYXRlV29ya2Zsb3cgPz8gdHJ1ZSkpXG4gICAgICAuZmxhdE1hcCgodGVzdENhc2U6IFRlc3RDYXNlKSA9PiB0ZXN0Q2FzZS5zdGFja3MpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGVzdCBjYXNlIG9wdGlvbnMgZm9yIGEgZ2l2ZW4gc3RhY2tcbiAgICovXG4gIHB1YmxpYyBnZXRPcHRpb25zRm9yU3RhY2soc3RhY2tJZDogc3RyaW5nKTogVGVzdE9wdGlvbnMgfCB1bmRlZmluZWQge1xuICAgIGZvciAoY29uc3QgdGVzdENhc2Ugb2YgT2JqZWN0LnZhbHVlcyh0aGlzLnRlc3RTdWl0ZSA/PyB7fSkpIHtcbiAgICAgIGlmICh0ZXN0Q2FzZS5zdGFja3MuaW5jbHVkZXMoc3RhY2tJZCkpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBob29rczogdGVzdENhc2UuaG9va3MsXG4gICAgICAgICAgcmVnaW9uczogdGVzdENhc2UucmVnaW9ucyxcbiAgICAgICAgICBkaWZmQXNzZXRzOiB0ZXN0Q2FzZS5kaWZmQXNzZXRzID8/IGZhbHNlLFxuICAgICAgICAgIGFsbG93RGVzdHJveTogdGVzdENhc2UuYWxsb3dEZXN0cm95LFxuICAgICAgICAgIGNka0NvbW1hbmRPcHRpb25zOiB0ZXN0Q2FzZS5jZGtDb21tYW5kT3B0aW9ucyxcbiAgICAgICAgICBzdGFja1VwZGF0ZVdvcmtmbG93OiB0ZXN0Q2FzZS5zdGFja1VwZGF0ZVdvcmtmbG93ID8/IHRydWUsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGEgbGlzdCBvZiBzdGFja3MgaW4gdGhlIHRlc3Qgc3VpdGVcbiAgICovXG4gIHB1YmxpYyBnZXQgc3RhY2tzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh0aGlzLnRlc3RTdWl0ZSkuZmxhdE1hcCh0ZXN0Q2FzZSA9PiB0ZXN0Q2FzZS5zdGFja3MpO1xuICB9XG59XG5cbi8qKlxuICogT3B0aW9ucyBmb3IgYSByZWFkaW5nIGEgbGVnYWN5IHRlc3QgY2FzZSBtYW5pZmVzdFxuICovXG5leHBvcnQgaW50ZXJmYWNlIExlZ2FjeVRlc3RDYXNlQ29uZmlnIHtcbiAgLyoqXG4gICAqIFRoZSBuYW1lIG9mIHRoZSB0ZXN0IGNhc2VcbiAgICovXG4gIHJlYWRvbmx5IHRlc3ROYW1lOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIE9wdGlvbnMgdG8gdXNlIHdoZW4gcGVyZm9ybWluZyBgY2RrIGxpc3RgXG4gICAqIFRoaXMgaXMgdXNlZCB0byBkZXRlcm1pbmUgdGhlIG5hbWUgb2YgdGhlIHN0YWNrc1xuICAgKiBpbiB0aGUgdGVzdCBjYXNlXG4gICAqL1xuICByZWFkb25seSBsaXN0T3B0aW9uczogTGlzdE9wdGlvbnM7XG5cbiAgLyoqXG4gICAqIEFuIGluc3RhbmNlIG9mIHRoZSBDREsgQ0xJIChlLmcuIENka0NsaVdyYXBwZXIpXG4gICAqL1xuICByZWFkb25seSBjZGs6IElDZGs7XG5cbiAgLyoqXG4gICAqIFRoZSBwYXRoIHRvIHRoZSBpbnRlZ3JhdGlvbiB0ZXN0IGZpbGVcbiAgICogaS5lLiBpbnRlZy50ZXN0LmpzXG4gICAqL1xuICByZWFkb25seSBpbnRlZ1NvdXJjZUZpbGVQYXRoOiBzdHJpbmc7XG59XG5cbi8qKlxuICogSGVscGVyIGNsYXNzIGZvciBjcmVhdGluZyBhbiBpbnRlZyBtYW5pZmVzdCBmb3IgbGVnYWN5XG4gKiB0ZXN0IGNhc2VzLCBpLmUuIHRlc3RzIHdpdGhvdXQgYSBgaW50ZWcuanNvbmAuXG4gKi9cbmV4cG9ydCBjbGFzcyBMZWdhY3lJbnRlZ1Rlc3RTdWl0ZSBleHRlbmRzIEludGVnVGVzdFN1aXRlIHtcbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNpbmdsZSB0ZXN0IHN0YWNrIHRvIHVzZS5cbiAgICpcbiAgICogSWYgdGhlIHRlc3QgaGFzIGEgc2luZ2xlIHN0YWNrLCBpdCB3aWxsIGJlIGNob3Nlbi4gT3RoZXJ3aXNlIGEgcHJhZ21hIGlzIGV4cGVjdGVkIHdpdGhpbiB0aGVcbiAgICogdGVzdCBmaWxlIHRoZSBuYW1lIG9mIHRoZSBzdGFjazpcbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICpcbiAgICogICAgLy8vICFjZGstaW50ZWcgPHN0YWNrLW5hbWU+XG4gICAqXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21MZWdhY3koY29uZmlnOiBMZWdhY3lUZXN0Q2FzZUNvbmZpZyk6IExlZ2FjeUludGVnVGVzdFN1aXRlIHtcbiAgICBjb25zdCBwcmFnbWFzID0gdGhpcy5wcmFnbWFzKGNvbmZpZy5pbnRlZ1NvdXJjZUZpbGVQYXRoKTtcbiAgICBjb25zdCB0ZXN0czogVGVzdENhc2UgPSB7XG4gICAgICBzdGFja3M6IFtdLFxuICAgICAgZGlmZkFzc2V0czogcHJhZ21hcy5pbmNsdWRlcyhWRVJJRllfQVNTRVRfSEFTSEVTKSxcbiAgICAgIHN0YWNrVXBkYXRlV29ya2Zsb3c6ICFwcmFnbWFzLmluY2x1ZGVzKERJU0FCTEVfVVBEQVRFX1dPUktGTE9XKSxcbiAgICB9O1xuICAgIGNvbnN0IHByYWdtYSA9IHRoaXMucmVhZFN0YWNrUHJhZ21hKGNvbmZpZy5pbnRlZ1NvdXJjZUZpbGVQYXRoKTtcbiAgICBpZiAocHJhZ21hLmxlbmd0aCA+IDApIHtcbiAgICAgIHRlc3RzLnN0YWNrcy5wdXNoKC4uLnByYWdtYSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG9wdGlvbnM6IExpc3RPcHRpb25zID0ge1xuICAgICAgICAuLi5jb25maWcubGlzdE9wdGlvbnMsXG4gICAgICAgIG5vdGljZXM6IGZhbHNlLFxuICAgICAgfTtcbiAgICAgIGNvbnN0IHN0YWNrcyA9IChjb25maWcuY2RrLmxpc3Qob3B0aW9ucykpLnNwbGl0KCdcXG4nKTtcbiAgICAgIGlmIChzdGFja3MubGVuZ3RoICE9PSAxKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignXCJjZGstaW50ZWdcIiBjYW4gb25seSBvcGVyYXRlIG9uIGFwcHMgd2l0aCBhIHNpbmdsZSBzdGFjay5cXG5cXG4nICtcbiAgICAgICAgICAnICBJZiB5b3VyIGFwcCBoYXMgbXVsdGlwbGUgc3RhY2tzLCBzcGVjaWZ5IHdoaWNoIHN0YWNrIHRvIHNlbGVjdCBieSBhZGRpbmcgdGhpcyB0byB5b3VyIHRlc3Qgc291cmNlOlxcblxcbicgK1xuICAgICAgICAgIGAgICAgICAke0NES19JTlRFR19TVEFDS19QUkFHTUF9IFNUQUNLIC4uLlxcblxcbmAgK1xuICAgICAgICAgIGAgIEF2YWlsYWJsZSBzdGFja3M6ICR7c3RhY2tzLmpvaW4oJyAnKX0gKHdpbGRjYXJkcyBhcmUgYWxzbyBzdXBwb3J0ZWQpXFxuYCk7XG4gICAgICB9XG4gICAgICBpZiAoc3RhY2tzLmxlbmd0aCA9PT0gMSAmJiBzdGFja3NbMF0gPT09ICcnKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3RhY2sgZm91bmQgZm9yIHRlc3QgJHtjb25maWcudGVzdE5hbWV9YCk7XG4gICAgICB9XG4gICAgICB0ZXN0cy5zdGFja3MucHVzaCguLi5zdGFja3MpO1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgTGVnYWN5SW50ZWdUZXN0U3VpdGUoXG4gICAgICBwcmFnbWFzLmluY2x1ZGVzKEVOQUJMRV9MT09LVVBTX1BSQUdNQSksXG4gICAgICB7XG4gICAgICAgIFtjb25maWcudGVzdE5hbWVdOiB0ZXN0cyxcbiAgICAgIH0sXG4gICAgICBMZWdhY3lJbnRlZ1Rlc3RTdWl0ZS5nZXRQcmFnbWFDb250ZXh0KGNvbmZpZy5pbnRlZ1NvdXJjZUZpbGVQYXRoKSxcbiAgICApO1xuICB9XG5cbiAgcHVibGljIHN0YXRpYyBnZXRQcmFnbWFDb250ZXh0KGludGVnU291cmNlRmlsZVBhdGg6IHN0cmluZyk6IFJlY29yZDxzdHJpbmcsIGFueT4ge1xuICAgIGNvbnN0IGN0eFByYWdtYUNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcblxuICAgIC8vIGFwcGx5IGNvbnRleHQgZnJvbSBzZXQtY29udGV4dCBwcmFnbWFcbiAgICAvLyB1c2FnZTogcHJhZ21hOnNldC1jb250ZXh0OmtleT12YWx1ZVxuICAgIGNvbnN0IGN0eFByYWdtYXMgPSAodGhpcy5wcmFnbWFzKGludGVnU291cmNlRmlsZVBhdGgpKS5maWx0ZXIocCA9PiBwLnN0YXJ0c1dpdGgoU0VUX0NPTlRFWFRfUFJBR01BX1BSRUZJWCkpO1xuICAgIGZvciAoY29uc3QgcCBvZiBjdHhQcmFnbWFzKSB7XG4gICAgICBjb25zdCBpbnN0cnVjdGlvbiA9IHAuc3Vic3RyaW5nKFNFVF9DT05URVhUX1BSQUdNQV9QUkVGSVgubGVuZ3RoKTtcbiAgICAgIGNvbnN0IFtrZXksIHZhbHVlXSA9IGluc3RydWN0aW9uLnNwbGl0KCc9Jyk7XG4gICAgICBpZiAoa2V5ID09IG51bGwgfHwgdmFsdWUgPT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGludmFsaWQgXCJzZXQtY29udGV4dFwiIHByYWdtYSBzeW50YXguIGV4YW1wbGU6IFwicHJhZ21hOnNldC1jb250ZXh0OkBhd3MtY2RrL2NvcmU6bmV3U3R5bGVTdGFja1N5bnRoZXNpcz10cnVlXCIgZ290OiAke3B9YCk7XG4gICAgICB9XG5cbiAgICAgIGN0eFByYWdtYUNvbnRleHRba2V5XSA9IHZhbHVlO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgLi4uY3R4UHJhZ21hQ29udGV4dCxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHN0YWNrIG5hbWVzIGZyb20gdGhlIFwiIWNkay1pbnRlZ1wiIHByYWdtYS5cbiAgICpcbiAgICogRXZlcnkgd29yZCB0aGF0J3MgTk9UIHByZWZpeGVkIGJ5IFwicHJhZ21hOlwiIGlzIGNvbnNpZGVyZWQgYSBzdGFjayBuYW1lLlxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKlxuICAgKiAgICAvLy8gIWNkay1pbnRlZyA8c3RhY2stbmFtZT5cbiAgICovXG4gIHByaXZhdGUgc3RhdGljIHJlYWRTdGFja1ByYWdtYShpbnRlZ1NvdXJjZUZpbGVQYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuICh0aGlzLnJlYWRJbnRlZ1ByYWdtYShpbnRlZ1NvdXJjZUZpbGVQYXRoKSkuZmlsdGVyKHAgPT4gIXAuc3RhcnRzV2l0aChQUkFHTUFfUFJFRklYKSk7XG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhcmJpdHJhcnkgY2RrLWludGVnIHByYWdtYSBkaXJlY3RpdmVzXG4gICAqXG4gICAqIFJlYWRzIHRoZSB0ZXN0IHNvdXJjZSBmaWxlIGFuZCBsb29rcyBmb3IgdGhlIFwiIWNkay1pbnRlZ1wiIHByYWdtYS4gSWYgaXQgZXhpc3RzLCByZXR1cm5zIGl0J3NcbiAgICogY29udGVudHMuIFRoaXMgYWxsb3dzIGludGVnIHRlc3RzIHRvIHN1cHBseSBjdXN0b20gY29tbWFuZCBsaW5lIGFyZ3VtZW50cyB0byBcImNkayBkZXBsb3lcIiBhbmQgXCJjZGsgc3ludGhcIi5cbiAgICpcbiAgICogQGV4YW1wbGVcbiAgICpcbiAgICogICAgLy8vICFjZGstaW50ZWcgWy4uLl1cbiAgICovXG4gIHByaXZhdGUgc3RhdGljIHJlYWRJbnRlZ1ByYWdtYShpbnRlZ1NvdXJjZUZpbGVQYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3Qgc291cmNlID0gZnMucmVhZEZpbGVTeW5jKGludGVnU291cmNlRmlsZVBhdGgsIHsgZW5jb2Rpbmc6ICd1dGYtOCcgfSk7XG4gICAgY29uc3QgcHJhZ21hTGluZSA9IHNvdXJjZS5zcGxpdCgnXFxuJykuZmluZCh4ID0+IHguc3RhcnRzV2l0aChDREtfSU5URUdfU1RBQ0tfUFJBR01BICsgJyAnKSk7XG4gICAgaWYgKCFwcmFnbWFMaW5lKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3QgYXJncyA9IHByYWdtYUxpbmUuc3Vic3RyaW5nKENES19JTlRFR19TVEFDS19QUkFHTUEubGVuZ3RoKS50cmltKCkuc3BsaXQoJyAnKTtcbiAgICBpZiAoYXJncy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzeW50YXggZm9yIGNkay1pbnRlZyBwcmFnbWEuIFVzYWdlOiBcIiR7Q0RLX0lOVEVHX1NUQUNLX1BSQUdNQX0gW1NUQUNLXSBbcHJhZ21hOlBSQUdNQV0gWy4uLl1cImApO1xuICAgIH1cbiAgICByZXR1cm4gYXJncztcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gdGhlIG5vbi1zdGFjayBwcmFnbWFzXG4gICAqXG4gICAqIFRoZXNlIGFyZSBhbGwgcHJhZ21hcyB0aGF0IHN0YXJ0IHdpdGggXCJwcmFnbWE6XCIuXG4gICAqXG4gICAqIEZvciBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eSByZWFzb25zLCBhbGwgcHJhZ21hcyB0aGF0IERPTidUIHN0YXJ0IHdpdGggdGhpc1xuICAgKiBzdHJpbmcgYXJlIGNvbnNpZGVyZWQgdG8gYmUgc3RhY2sgbmFtZXMuXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBwcmFnbWFzKGludGVnU291cmNlRmlsZVBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gKHRoaXMucmVhZEludGVnUHJhZ21hKGludGVnU291cmNlRmlsZVBhdGgpKS5maWx0ZXIocCA9PiBwLnN0YXJ0c1dpdGgoUFJBR01BX1BSRUZJWCkpO1xuICB9XG5cbiAgcHVibGljIHJlYWRvbmx5IHR5cGU6IFRlc3RTdWl0ZVR5cGUgPSAnbGVnYWN5LXRlc3Qtc3VpdGUnO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyByZWFkb25seSBlbmFibGVMb29rdXBzOiBib29sZWFuLFxuICAgIHB1YmxpYyByZWFkb25seSB0ZXN0U3VpdGU6IFRlc3RTdWl0ZSxcbiAgICBwdWJsaWMgcmVhZG9ubHkgc3ludGhDb250ZXh0PzogeyBbbmFtZTogc3RyaW5nXTogc3RyaW5nIH0sXG4gICkge1xuICAgIHN1cGVyKGVuYWJsZUxvb2t1cHMsIHRlc3RTdWl0ZSk7XG4gIH1cblxuICAvKipcbiAgICogU2F2ZSB0aGUgaW50ZWcgbWFuaWZlc3QgdG8gYSBkaXJlY3RvcnlcbiAgICovXG4gIHB1YmxpYyBzYXZlTWFuaWZlc3QoZGlyZWN0b3J5OiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+KTogdm9pZCB7XG4gICAgY29uc3QgbWFuaWZlc3Q6IEludGVnTWFuaWZlc3QgPSB7XG4gICAgICB2ZXJzaW9uOiBNYW5pZmVzdC52ZXJzaW9uKCksXG4gICAgICB0ZXN0Q2FzZXM6IHRoaXMudGVzdFN1aXRlLFxuICAgICAgc3ludGhDb250ZXh0OiBjb250ZXh0LFxuICAgICAgZW5hYmxlTG9va3VwczogdGhpcy5lbmFibGVMb29rdXBzLFxuICAgIH07XG4gICAgTWFuaWZlc3Quc2F2ZUludGVnTWFuaWZlc3QobWFuaWZlc3QsIG9zUGF0aC5qb2luKGRpcmVjdG9yeSwgSW50ZWdNYW5pZmVzdFJlYWRlci5ERUZBVUxUX0ZJTEVOQU1FKSk7XG4gIH1cbn1cbiJdfQ==