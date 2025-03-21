"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationTests = exports.IntegTest = void 0;
const path = require("path");
const fs = require("fs-extra");
const CDK_OUTDIR_PREFIX = 'cdk-integ.out';
/**
 * Derived information for IntegTests
 */
class IntegTest {
    constructor(info) {
        this.info = info;
        this.appCommand = info.appCommand ?? 'node {filePath}';
        this.absoluteFileName = path.resolve(info.fileName);
        this.fileName = path.relative(process.cwd(), info.fileName);
        const parsed = path.parse(this.fileName);
        this.discoveryRelativeFileName = path.relative(info.discoveryRoot, info.fileName);
        // if `--watch` then we need the directory to be the cwd
        this.directory = info.watch ? process.cwd() : parsed.dir;
        // if we are running in a package directory then just use the fileName
        // as the testname, but if we are running in a parent directory with
        // multiple packages then use the directory/filename as the testname
        //
        // Looks either like `integ.mytest` or `package/test/integ.mytest`.
        const relDiscoveryRoot = path.relative(process.cwd(), info.discoveryRoot);
        this.testName = this.directory === path.join(relDiscoveryRoot, 'test') || this.directory === path.join(relDiscoveryRoot)
            ? parsed.name
            : path.join(path.relative(this.info.discoveryRoot, parsed.dir), parsed.name);
        this.normalizedTestName = parsed.name;
        this.snapshotDir = path.join(parsed.dir, `${parsed.base}.snapshot`);
        this.temporaryOutputDir = path.join(parsed.dir, `${CDK_OUTDIR_PREFIX}.${parsed.base}.snapshot`);
    }
    /**
     * Whether this test matches the user-given name
     *
     * We are very lenient here. A name matches if it matches:
     *
     * - The CWD-relative filename
     * - The discovery root-relative filename
     * - The suite name
     * - The absolute filename
     */
    matches(name) {
        return [
            this.fileName,
            this.discoveryRelativeFileName,
            this.testName,
            this.absoluteFileName,
        ].includes(name);
    }
}
exports.IntegTest = IntegTest;
/**
 * Returns the name of the Python executable for the current OS
 */
function pythonExecutable() {
    let python = 'python3';
    if (process.platform === 'win32') {
        python = 'python';
    }
    return python;
}
/**
 * Discover integration tests
 */
class IntegrationTests {
    constructor(directory) {
        this.directory = directory;
    }
    /**
     * Get integration tests discovery options from CLI options
     */
    async fromCliOptions(options) {
        const baseOptions = {
            tests: options.tests,
            exclude: options.exclude,
        };
        // Explicitly set both, app and test-regex
        if (options.app && options.testRegex) {
            return this.discover({
                testCases: {
                    [options.app]: options.testRegex,
                },
                ...baseOptions,
            });
        }
        // Use the selected presets
        if (!options.app && !options.testRegex) {
            // Only case with multiple languages, i.e. the only time we need to check the special case
            const ignoreUncompiledTypeScript = options.language?.includes('javascript') && options.language?.includes('typescript');
            return this.discover({
                testCases: this.getLanguagePresets(options.language),
                ...baseOptions,
            }, ignoreUncompiledTypeScript);
        }
        // Only one of app or test-regex is set, with a single preset selected
        // => override either app or test-regex
        if (options.language?.length === 1) {
            const [presetApp, presetTestRegex] = this.getLanguagePreset(options.language[0]);
            return this.discover({
                testCases: {
                    [options.app ?? presetApp]: options.testRegex ?? presetTestRegex,
                },
                ...baseOptions,
            });
        }
        // Only one of app or test-regex is set, with multiple presets
        // => impossible to resolve
        const option = options.app ? '--app' : '--test-regex';
        throw new Error(`Only a single "--language" can be used with "${option}". Alternatively provide both "--app" and "--test-regex" to fully customize the configuration.`);
    }
    /**
     * Get the default configuration for a language
     */
    getLanguagePreset(language) {
        const languagePresets = {
            javascript: ['node {filePath}', ['^integ\\..*\\.js$']],
            typescript: ['node -r ts-node/register {filePath}', ['^integ\\.(?!.*\\.d\\.ts$).*\\.ts$']],
            python: [`${pythonExecutable()} {filePath}`, ['^integ_.*\\.py$']],
            go: ['go run {filePath}', ['^integ_.*\\.go$']],
        };
        return languagePresets[language];
    }
    /**
     * Get the config for all selected languages
     */
    getLanguagePresets(languages = []) {
        return Object.fromEntries(languages
            .map(language => this.getLanguagePreset(language))
            .filter(Boolean));
    }
    /**
     * If the user provides a list of tests, these can either be a list of tests to include or a list of tests to exclude.
     *
     * - If it is a list of tests to include then we discover all available tests and check whether they have provided valid tests.
     *   If they have provided a test name that we don't find, then we write out that error message.
     * - If it is a list of tests to exclude, then we discover all available tests and filter out the tests that were provided by the user.
     */
    filterTests(discoveredTests, requestedTests, exclude) {
        if (!requestedTests) {
            return discoveredTests;
        }
        const allTests = discoveredTests.filter(t => {
            const matches = requestedTests.some(pattern => t.matches(pattern));
            return matches !== !!exclude; // Looks weird but is equal to (matches && !exclude) || (!matches && exclude)
        });
        // If not excluding, all patterns must have matched at least one test
        if (!exclude) {
            const unmatchedPatterns = requestedTests.filter(pattern => !discoveredTests.some(t => t.matches(pattern)));
            for (const unmatched of unmatchedPatterns) {
                process.stderr.write(`No such integ test: ${unmatched}\n`);
            }
            if (unmatchedPatterns.length > 0) {
                process.stderr.write(`Available tests: ${discoveredTests.map(t => t.discoveryRelativeFileName).join(' ')}\n`);
                return [];
            }
        }
        return allTests;
    }
    /**
     * Takes an optional list of tests to look for, otherwise
     * it will look for all tests from the directory
     *
     * @param tests Tests to include or exclude, undefined means include all tests.
     * @param exclude Whether the 'tests' list is inclusive or exclusive (inclusive by default).
     */
    async discover(options, ignoreUncompiledTypeScript = false) {
        const files = await this.readTree();
        const testCases = Object.entries(options.testCases)
            .flatMap(([appCommand, patterns]) => files
            .filter(fileName => patterns.some((pattern) => {
            const regex = new RegExp(pattern);
            return regex.test(fileName) || regex.test(path.basename(fileName));
        }))
            .map(fileName => new IntegTest({
            discoveryRoot: this.directory,
            fileName,
            appCommand,
        })));
        const discoveredTests = ignoreUncompiledTypeScript ? this.filterUncompiledTypeScript(testCases) : testCases;
        return this.filterTests(discoveredTests, options.tests, options.exclude);
    }
    filterUncompiledTypeScript(testCases) {
        const jsTestCases = testCases.filter(t => t.fileName.endsWith('.js'));
        return testCases
            // Remove all TypeScript test cases (ending in .ts)
            // for which a compiled version is present (same name, ending in .js)
            .filter((tsCandidate) => {
            if (!tsCandidate.fileName.endsWith('.ts')) {
                return true;
            }
            return jsTestCases.findIndex(jsTest => jsTest.testName === tsCandidate.testName) === -1;
        });
    }
    async readTree() {
        const ret = new Array();
        async function recurse(dir) {
            const files = await fs.readdir(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const statf = await fs.stat(fullPath);
                if (statf.isFile()) {
                    ret.push(fullPath);
                }
                if (statf.isDirectory()) {
                    await recurse(fullPath);
                }
            }
        }
        await recurse(this.directory);
        return ret;
    }
}
exports.IntegrationTests = IntegrationTests;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW50ZWdyYXRpb24tdGVzdHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbnRlZ3JhdGlvbi10ZXN0cy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2QkFBNkI7QUFDN0IsK0JBQStCO0FBRS9CLE1BQU0saUJBQWlCLEdBQUcsZUFBZSxDQUFDO0FBdUMxQzs7R0FFRztBQUNILE1BQWEsU0FBUztJQTJEcEIsWUFBNEIsSUFBbUI7UUFBbkIsU0FBSSxHQUFKLElBQUksQ0FBZTtRQUM3QyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxVQUFVLElBQUksaUJBQWlCLENBQUM7UUFDdkQsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3BELElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRTVELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3pDLElBQUksQ0FBQyx5QkFBeUIsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ2xGLHdEQUF3RDtRQUN4RCxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQztRQUV6RCxzRUFBc0U7UUFDdEUsb0VBQW9FO1FBQ3BFLG9FQUFvRTtRQUNwRSxFQUFFO1FBQ0YsbUVBQW1FO1FBQ25FLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFLEVBQUUsSUFBSSxDQUFD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QyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7Z0JBQ3JCLENBQUM7Z0JBQ0QsSUFBSSxLQUFLLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztvQkFDeEIsTUFBTSxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUM7Z0JBQzFCLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELE1BQU0sT0FBTyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUM5QixPQUFPLEdBQUcsQ0FBQztJQUNiLENBQUM7Q0FDRjtBQW5MRCw0Q0FtTEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuXG5jb25zdCBDREtfT1VURElSX1BSRUZJWCA9ICdjZGstaW50ZWcub3V0JztcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgc2luZ2xlIGludGVncmF0aW9uIHRlc3RcbiAqXG4gKiBUaGlzIHR5cGUgaXMgYSBkYXRhLW9ubHkgc3RydWN0dXJlLCBzbyBpdCBjYW4gdHJpdmlhbGx5IGJlIHBhc3NlZCB0byB3b3JrZXJzLlxuICogRGVyaXZlZCBhdHRyaWJ1dGVzIGFyZSBjYWxjdWxhdGVkIHVzaW5nIHRoZSBgSW50ZWdUZXN0YCBjbGFzcy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJbnRlZ1Rlc3RJbmZvIHtcbiAgLyoqXG4gICAqIFBhdGggdG8gdGhlIGZpbGUgdG8gcnVuXG4gICAqXG4gICAqIFBhdGggaXMgcmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgd29ya2luZyBkaXJlY3RvcnkuXG4gICAqL1xuICByZWFkb25seSBmaWxlTmFtZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgcm9vdCBkaXJlY3Rvcnkgd2UgZGlzY292ZXJlZCB0aGlzIHRlc3QgZnJvbVxuICAgKlxuICAgKiBQYXRoIGlzIHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5LlxuICAgKi9cbiAgcmVhZG9ubHkgZGlzY292ZXJ5Um9vdDogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgQ0xJIGNvbW1hbmQgdXNlZCB0byBydW4gdGhpcyB0ZXN0LlxuICAgKiBJZiBpdCBjb250YWlucyB7ZmlsZVBhdGh9LCB0aGUgdGVzdCBmaWxlIG5hbWVzIHdpbGwgYmUgc3Vic3RpdHV0ZWQgYXQgdGhhdCBwbGFjZSBpbiB0aGUgY29tbWFuZCBmb3IgZWFjaCBydW4uXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gdGVzdCBydW4gY29tbWFuZCB3aWxsIGJlIGBub2RlIHtmaWxlUGF0aH1gXG4gICAqL1xuICByZWFkb25seSBhcHBDb21tYW5kPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiB0cnVlIGlmIHRoaXMgdGVzdCBpcyBydW5uaW5nIGluIHdhdGNoIG1vZGVcbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IHdhdGNoPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBEZXJpdmVkIGluZm9ybWF0aW9uIGZvciBJbnRlZ1Rlc3RzXG4gKi9cbmV4cG9ydCBjbGFzcyBJbnRlZ1Rlc3Qge1xuICAvKipcbiAgICogVGhlIG5hbWUgb2YgdGhlIGZpbGUgdG8gcnVuXG4gICAqXG4gICAqIFBhdGggaXMgcmVsYXRpdmUgdG8gdGhlIGN1cnJlbnQgd29ya2luZyBkaXJlY3RvcnkuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgZmlsZU5hbWU6IHN0cmluZztcblxuICAvKipcbiAgICogUmVsYXRpdmUgcGF0aCB0byB0aGUgZmlsZSB0byBydW5cbiAgICpcbiAgICogUmVsYXRpdmUgZnJvbSB0aGUgXCJkaXNjb3Zlcnkgcm9vdFwiLlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGRpc2NvdmVyeVJlbGF0aXZlRmlsZU5hbWU6IHN0cmluZztcblxuICAvKipcbiAgICogVGhlIGFic29sdXRlIHBhdGggdG8gdGhlIGZpbGVcbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBhYnNvbHV0ZUZpbGVOYW1lOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBub3JtYWxpemVkIG5hbWUgb2YgdGhlIHRlc3QuIFRoaXMgbmFtZVxuICAgKiB3aWxsIGJlIHRoZSBzYW1lIHJlZ2FyZGxlc3Mgb2Ygd2hhdCBkaXJlY3RvcnkgdGhlIHRvb2xcbiAgICogaXMgcnVuIGZyb20uXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgbm9ybWFsaXplZFRlc3ROYW1lOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIERpcmVjdG9yeSB0aGUgdGVzdCBpcyBpblxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGRpcmVjdG9yeTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBEaXNwbGF5IG5hbWUgZm9yIHRoZSB0ZXN0XG4gICAqXG4gICAqIERlcGVuZHMgb24gdGhlIGRpc2NvdmVyeSBkaXJlY3RvcnkuXG4gICAqXG4gICAqIExvb2tzIGxpa2UgYGludGVnLm15dGVzdGAgb3IgYHBhY2thZ2UvdGVzdC9pbnRlZy5teXRlc3RgLlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHRlc3ROYW1lOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFBhdGggb2YgdGhlIHNuYXBzaG90IGRpcmVjdG9yeSBmb3IgdGhpcyB0ZXN0XG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgc25hcHNob3REaXI6IHN0cmluZztcblxuICAvKipcbiAgICogUGF0aCB0byB0aGUgdGVtcG9yYXJ5IG91dHB1dCBkaXJlY3RvcnkgZm9yIHRoaXMgdGVzdFxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHRlbXBvcmFyeU91dHB1dERpcjogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgQ0xJIGNvbW1hbmQgdXNlZCB0byBydW4gdGhpcyB0ZXN0LlxuICAgKiBJZiBpdCBjb250YWlucyB7ZmlsZVBhdGh9LCB0aGUgdGVzdCBmaWxlIG5hbWVzIHdpbGwgYmUgc3Vic3RpdHV0ZWQgYXQgdGhhdCBwbGFjZSBpbiB0aGUgY29tbWFuZCBmb3IgZWFjaCBydW4uXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gdGVzdCBydW4gY29tbWFuZCB3aWxsIGJlIGBub2RlIHtmaWxlUGF0aH1gXG4gICAqL1xuICByZWFkb25seSBhcHBDb21tYW5kOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IocHVibGljIHJlYWRvbmx5IGluZm86IEludGVnVGVzdEluZm8pIHtcbiAgICB0aGlzLmFwcENvbW1hbmQgPSBpbmZvLmFwcENvbW1hbmQgPz8gJ25vZGUge2ZpbGVQYXRofSc7XG4gICAgdGhpcy5hYnNvbHV0ZUZpbGVOYW1lID0gcGF0aC5yZXNvbHZlKGluZm8uZmlsZU5hbWUpO1xuICAgIHRoaXMuZmlsZU5hbWUgPSBwYXRoLnJlbGF0aXZlKHByb2Nlc3MuY3dkKCksIGluZm8uZmlsZU5hbWUpO1xuXG4gICAgY29uc3QgcGFyc2VkID0gcGF0aC5wYXJzZSh0aGlzLmZpbGVOYW1lKTtcbiAgICB0aGlzLmRpc2NvdmVyeVJlbGF0aXZlRmlsZU5hbWUgPSBwYXRoLnJlbGF0aXZlKGluZm8uZGlzY292ZXJ5Um9vdCwgaW5mby5maWxlTmFtZSk7XG4gICAgLy8gaWYgYC0td2F0Y2hgIHRoZW4gd2UgbmVlZCB0aGUgZGlyZWN0b3J5IHRvIGJlIHRoZSBjd2RcbiAgICB0aGlzLmRpcmVjdG9yeSA9IGluZm8ud2F0Y2ggPyBwcm9jZXNzLmN3ZCgpIDogcGFyc2VkLmRpcjtcblxuICAgIC8vIGlmIHdlIGFyZSBydW5uaW5nIGluIGEgcGFja2FnZSBkaXJlY3RvcnkgdGhlbiBqdXN0IHVzZSB0aGUgZmlsZU5hbWVcbiAgICAvLyBhcyB0aGUgdGVzdG5hbWUsIGJ1dCBpZiB3ZSBhcmUgcnVubmluZyBpbiBhIHBhcmVudCBkaXJlY3Rvcnkgd2l0aFxuICAgIC8vIG11bHRpcGxlIHBhY2thZ2VzIHRoZW4gdXNlIHRoZSBkaXJlY3RvcnkvZmlsZW5hbWUgYXMgdGhlIHRlc3RuYW1lXG4gICAgLy9cbiAgICAvLyBMb29rcyBlaXRoZXIgbGlrZSBgaW50ZWcubXl0ZXN0YCBvciBgcGFja2FnZS90ZXN0L2ludGVnLm15dGVzdGAuXG4gICAgY29uc3QgcmVsRGlzY292ZXJ5Um9vdCA9IHBhdGgucmVsYXRpdmUocHJvY2Vzcy5jd2QoKSwgaW5mby5kaXNjb3ZlcnlSb290KTtcbiAgICB0aGlzLnRlc3ROYW1lID0gdGhpcy5kaXJlY3RvcnkgPT09IHBhdGguam9pbihyZWxEaXNjb3ZlcnlSb290LCAndGVzdCcpIHx8IHRoaXMuZGlyZWN0b3J5ID09PSBwYXRoLmpvaW4ocmVsRGlzY292ZXJ5Um9vdClcbiAgICAgID8gcGFyc2VkLm5hbWVcbiAgICAgIDogcGF0aC5qb2luKHBhdGgucmVsYXRpdmUodGhpcy5pbmZvLmRpc2NvdmVyeVJvb3QsIHBhcnNlZC5kaXIpLCBwYXJzZWQubmFtZSk7XG5cbiAgICB0aGlzLm5vcm1hbGl6ZWRUZXN0TmFtZSA9IHBhcnNlZC5uYW1lO1xuICAgIHRoaXMuc25hcHNob3REaXIgPSBwYXRoLmpvaW4ocGFyc2VkLmRpciwgYCR7cGFyc2VkLmJhc2V9LnNuYXBzaG90YCk7XG4gICAgdGhpcy50ZW1wb3JhcnlPdXRwdXREaXIgPSBwYXRoLmpvaW4ocGFyc2VkLmRpciwgYCR7Q0RLX09VVERJUl9QUkVGSVh9LiR7cGFyc2VkLmJhc2V9LnNuYXBzaG90YCk7XG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIHRlc3QgbWF0Y2hlcyB0aGUgdXNlci1naXZlbiBuYW1lXG4gICAqXG4gICAqIFdlIGFyZSB2ZXJ5IGxlbmllbnQgaGVyZS4gQSBuYW1lIG1hdGNoZXMgaWYgaXQgbWF0Y2hlczpcbiAgICpcbiAgICogLSBUaGUgQ1dELXJlbGF0aXZlIGZpbGVuYW1lXG4gICAqIC0gVGhlIGRpc2NvdmVyeSByb290LXJlbGF0aXZlIGZpbGVuYW1lXG4gICAqIC0gVGhlIHN1aXRlIG5hbWVcbiAgICogLSBUaGUgYWJzb2x1dGUgZmlsZW5hbWVcbiAgICovXG4gIHB1YmxpYyBtYXRjaGVzKG5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiBbXG4gICAgICB0aGlzLmZpbGVOYW1lLFxuICAgICAgdGhpcy5kaXNjb3ZlcnlSZWxhdGl2ZUZpbGVOYW1lLFxuICAgICAgdGhpcy50ZXN0TmFtZSxcbiAgICAgIHRoaXMuYWJzb2x1dGVGaWxlTmFtZSxcbiAgICBdLmluY2x1ZGVzKG5hbWUpO1xuICB9XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBvcHRpb25zIGhvdyBpbnRlZ3JhdGlvbiB0ZXN0IGZpbGVzIGFyZSBkaXNjb3ZlcmVkXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSW50ZWdyYXRpb25UZXN0c0Rpc2NvdmVyeU9wdGlvbnMge1xuICAvKipcbiAgICogSWYgdGhpcyBpcyBzZXQgdG8gdHJ1ZSB0aGVuIHRoZSBsaXN0IG9mIHRlc3RzXG4gICAqIHByb3ZpZGVkIHdpbGwgYmUgZXhjbHVkZWRcbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IGV4Y2x1ZGU/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBMaXN0IG9mIHRlc3RzIHRvIGluY2x1ZGUgKG9yIGV4Y2x1ZGUgaWYgYGV4Y2x1ZGU9dHJ1ZWApXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gYWxsIG1hdGNoZWQgZmlsZXNcbiAgICovXG4gIHJlYWRvbmx5IHRlc3RzPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEEgbWFwIG9mIG9mIHRoZSBhcHAgY29tbWFuZHMgdG8gcnVuIGludGVncmF0aW9uIHRlc3RzIHdpdGgsXG4gICAqIGFuZCB0aGUgcmVnZXggcGF0dGVybnMgbWF0Y2hpbmcgdGhlIGludGVncmF0aW9uIHRlc3QgZmlsZXMgZWFjaCBhcHAgY29tbWFuZC5cbiAgICpcbiAgICogSWYgdGhlIGFwcCBjb21tYW5kIGNvbnRhaW5zIHtmaWxlUGF0aH0sIHRoZSB0ZXN0IGZpbGUgbmFtZXMgd2lsbCBiZSBzdWJzdGl0dXRlZCBhdCB0aGF0IHBsYWNlIGluIHRoZSBjb21tYW5kIGZvciBlYWNoIHJ1bi5cbiAgICovXG4gIHJlYWRvbmx5IHRlc3RDYXNlczoge1xuICAgIFthcHA6IHN0cmluZ106IHN0cmluZ1tdO1xuICB9O1xufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIG5hbWUgb2YgdGhlIFB5dGhvbiBleGVjdXRhYmxlIGZvciB0aGUgY3VycmVudCBPU1xuICovXG5mdW5jdGlvbiBweXRob25FeGVjdXRhYmxlKCkge1xuICBsZXQgcHl0aG9uID0gJ3B5dGhvbjMnO1xuICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgIHB5dGhvbiA9ICdweXRob24nO1xuICB9XG4gIHJldHVybiBweXRob247XG59XG5cbi8qKlxuICogRGlzY292ZXIgaW50ZWdyYXRpb24gdGVzdHNcbiAqL1xuZXhwb3J0IGNsYXNzIEludGVncmF0aW9uVGVzdHMge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGRpcmVjdG9yeTogc3RyaW5nKSB7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGludGVncmF0aW9uIHRlc3RzIGRpc2NvdmVyeSBvcHRpb25zIGZyb20gQ0xJIG9wdGlvbnNcbiAgICovXG4gIHB1YmxpYyBhc3luYyBmcm9tQ2xpT3B0aW9ucyhvcHRpb25zOiB7XG4gICAgYXBwPzogc3RyaW5nO1xuICAgIGV4Y2x1ZGU/OiBib29sZWFuO1xuICAgIGxhbmd1YWdlPzogc3RyaW5nW107XG4gICAgdGVzdFJlZ2V4Pzogc3RyaW5nW107XG4gICAgdGVzdHM/OiBzdHJpbmdbXTtcbiAgfSk6IFByb21pc2U8SW50ZWdUZXN0W10+IHtcbiAgICBjb25zdCBiYXNlT3B0aW9ucyA9IHtcbiAgICAgIHRlc3RzOiBvcHRpb25zLnRlc3RzLFxuICAgICAgZXhjbHVkZTogb3B0aW9ucy5leGNsdWRlLFxuICAgIH07XG5cbiAgICAvLyBFeHBsaWNpdGx5IHNldCBib3RoLCBhcHAgYW5kIHRlc3QtcmVnZXhcbiAgICBpZiAob3B0aW9ucy5hcHAgJiYgb3B0aW9ucy50ZXN0UmVnZXgpIHtcbiAgICAgIHJldHVybiB0aGlzLmRpc2NvdmVyKHtcbiAgICAgICAgdGVzdENhc2VzOiB7XG4gICAgICAgICAgW29wdGlvbnMuYXBwXTogb3B0aW9ucy50ZXN0UmVnZXgsXG4gICAgICAgIH0sXG4gICAgICAgIC4uLmJhc2VPcHRpb25zLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gVXNlIHRoZSBzZWxlY3RlZCBwcmVzZXRzXG4gICAgaWYgKCFvcHRpb25zLmFwcCAmJiAhb3B0aW9ucy50ZXN0UmVnZXgpIHtcbiAgICAgIC8vIE9ubHkgY2FzZSB3aXRoIG11bHRpcGxlIGxhbmd1YWdlcywgaS5lLiB0aGUgb25seSB0aW1lIHdlIG5lZWQgdG8gY2hlY2sgdGhlIHNwZWNpYWwgY2FzZVxuICAgICAgY29uc3QgaWdub3JlVW5jb21waWxlZFR5cGVTY3JpcHQgPSBvcHRpb25zLmxhbmd1YWdlPy5pbmNsdWRlcygnamF2YXNjcmlwdCcpICYmIG9wdGlvbnMubGFuZ3VhZ2U/LmluY2x1ZGVzKCd0eXBlc2NyaXB0Jyk7XG5cbiAgICAgIHJldHVybiB0aGlzLmRpc2NvdmVyKHtcbiAgICAgICAgdGVzdENhc2VzOiB0aGlzLmdldExhbmd1YWdlUHJlc2V0cyhvcHRpb25zLmxhbmd1YWdlKSxcbiAgICAgICAgLi4uYmFzZU9wdGlvbnMsXG4gICAgICB9LCBpZ25vcmVVbmNvbXBpbGVkVHlwZVNjcmlwdCk7XG4gICAgfVxuXG4gICAgLy8gT25seSBvbmUgb2YgYXBwIG9yIHRlc3QtcmVnZXggaXMgc2V0LCB3aXRoIGEgc2luZ2xlIHByZXNldCBzZWxlY3RlZFxuICAgIC8vID0+IG92ZXJyaWRlIGVpdGhlciBhcHAgb3IgdGVzdC1yZWdleFxuICAgIGlmIChvcHRpb25zLmxhbmd1YWdlPy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGNvbnN0IFtwcmVzZXRBcHAsIHByZXNldFRlc3RSZWdleF0gPSB0aGlzLmdldExhbmd1YWdlUHJlc2V0KG9wdGlvbnMubGFuZ3VhZ2VbMF0pO1xuICAgICAgcmV0dXJuIHRoaXMuZGlzY292ZXIoe1xuICAgICAgICB0ZXN0Q2FzZXM6IHtcbiAgICAgICAgICBbb3B0aW9ucy5hcHAgPz8gcHJlc2V0QXBwXTogb3B0aW9ucy50ZXN0UmVnZXggPz8gcHJlc2V0VGVzdFJlZ2V4LFxuICAgICAgICB9LFxuICAgICAgICAuLi5iYXNlT3B0aW9ucyxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIE9ubHkgb25lIG9mIGFwcCBvciB0ZXN0LXJlZ2V4IGlzIHNldCwgd2l0aCBtdWx0aXBsZSBwcmVzZXRzXG4gICAgLy8gPT4gaW1wb3NzaWJsZSB0byByZXNvbHZlXG4gICAgY29uc3Qgb3B0aW9uID0gb3B0aW9ucy5hcHAgPyAnLS1hcHAnIDogJy0tdGVzdC1yZWdleCc7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBPbmx5IGEgc2luZ2xlIFwiLS1sYW5ndWFnZVwiIGNhbiBiZSB1c2VkIHdpdGggXCIke29wdGlvbn1cIi4gQWx0ZXJuYXRpdmVseSBwcm92aWRlIGJvdGggXCItLWFwcFwiIGFuZCBcIi0tdGVzdC1yZWdleFwiIHRvIGZ1bGx5IGN1c3RvbWl6ZSB0aGUgY29uZmlndXJhdGlvbi5gKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGRlZmF1bHQgY29uZmlndXJhdGlvbiBmb3IgYSBsYW5ndWFnZVxuICAgKi9cbiAgcHJpdmF0ZSBnZXRMYW5ndWFnZVByZXNldChsYW5ndWFnZTogc3RyaW5nKSB7XG4gICAgY29uc3QgbGFuZ3VhZ2VQcmVzZXRzOiB7XG4gICAgICBbbGFuZ3VhZ2U6IHN0cmluZ106IFtzdHJpbmcsIHN0cmluZ1tdXTtcbiAgICB9ID0ge1xuICAgICAgamF2YXNjcmlwdDogWydub2RlIHtmaWxlUGF0aH0nLCBbJ15pbnRlZ1xcXFwuLipcXFxcLmpzJCddXSxcbiAgICAgIHR5cGVzY3JpcHQ6IFsnbm9kZSAtciB0cy1ub2RlL3JlZ2lzdGVyIHtmaWxlUGF0aH0nLCBbJ15pbnRlZ1xcXFwuKD8hLipcXFxcLmRcXFxcLnRzJCkuKlxcXFwudHMkJ11dLFxuICAgICAgcHl0aG9uOiBbYCR7cHl0aG9uRXhlY3V0YWJsZSgpfSB7ZmlsZVBhdGh9YCwgWydeaW50ZWdfLipcXFxcLnB5JCddXSxcbiAgICAgIGdvOiBbJ2dvIHJ1biB7ZmlsZVBhdGh9JywgWydeaW50ZWdfLipcXFxcLmdvJCddXSxcbiAgICB9O1xuXG4gICAgcmV0dXJuIGxhbmd1YWdlUHJlc2V0c1tsYW5ndWFnZV07XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBjb25maWcgZm9yIGFsbCBzZWxlY3RlZCBsYW5ndWFnZXNcbiAgICovXG4gIHByaXZhdGUgZ2V0TGFuZ3VhZ2VQcmVzZXRzKGxhbmd1YWdlczogc3RyaW5nW10gPSBbXSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICBsYW5ndWFnZXNcbiAgICAgICAgLm1hcChsYW5ndWFnZSA9PiB0aGlzLmdldExhbmd1YWdlUHJlc2V0KGxhbmd1YWdlKSlcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKSxcbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIElmIHRoZSB1c2VyIHByb3ZpZGVzIGEgbGlzdCBvZiB0ZXN0cywgdGhlc2UgY2FuIGVpdGhlciBiZSBhIGxpc3Qgb2YgdGVzdHMgdG8gaW5jbHVkZSBvciBhIGxpc3Qgb2YgdGVzdHMgdG8gZXhjbHVkZS5cbiAgICpcbiAgICogLSBJZiBpdCBpcyBhIGxpc3Qgb2YgdGVzdHMgdG8gaW5jbHVkZSB0aGVuIHdlIGRpc2NvdmVyIGFsbCBhdmFpbGFibGUgdGVzdHMgYW5kIGNoZWNrIHdoZXRoZXIgdGhleSBoYXZlIHByb3ZpZGVkIHZhbGlkIHRlc3RzLlxuICAgKiAgIElmIHRoZXkgaGF2ZSBwcm92aWRlZCBhIHRlc3QgbmFtZSB0aGF0IHdlIGRvbid0IGZpbmQsIHRoZW4gd2Ugd3JpdGUgb3V0IHRoYXQgZXJyb3IgbWVzc2FnZS5cbiAgICogLSBJZiBpdCBpcyBhIGxpc3Qgb2YgdGVzdHMgdG8gZXhjbHVkZSwgdGhlbiB3ZSBkaXNjb3ZlciBhbGwgYXZhaWxhYmxlIHRlc3RzIGFuZCBmaWx0ZXIgb3V0IHRoZSB0ZXN0cyB0aGF0IHdlcmUgcHJvdmlkZWQgYnkgdGhlIHVzZXIuXG4gICAqL1xuICBwcml2YXRlIGZpbHRlclRlc3RzKGRpc2NvdmVyZWRUZXN0czogSW50ZWdUZXN0W10sIHJlcXVlc3RlZFRlc3RzPzogc3RyaW5nW10sIGV4Y2x1ZGU/OiBib29sZWFuKTogSW50ZWdUZXN0W10ge1xuICAgIGlmICghcmVxdWVzdGVkVGVzdHMpIHtcbiAgICAgIHJldHVybiBkaXNjb3ZlcmVkVGVzdHM7XG4gICAgfVxuXG4gICAgY29uc3QgYWxsVGVzdHMgPSBkaXNjb3ZlcmVkVGVzdHMuZmlsdGVyKHQgPT4ge1xuICAgICAgY29uc3QgbWF0Y2hlcyA9IHJlcXVlc3RlZFRlc3RzLnNvbWUocGF0dGVybiA9PiB0Lm1hdGNoZXMocGF0dGVybikpO1xuICAgICAgcmV0dXJuIG1hdGNoZXMgIT09ICEhZXhjbHVkZTsgLy8gTG9va3Mgd2VpcmQgYnV0IGlzIGVxdWFsIHRvIChtYXRjaGVzICYmICFleGNsdWRlKSB8fCAoIW1hdGNoZXMgJiYgZXhjbHVkZSlcbiAgICB9KTtcblxuICAgIC8vIElmIG5vdCBleGNsdWRpbmcsIGFsbCBwYXR0ZXJucyBtdXN0IGhhdmUgbWF0Y2hlZCBhdCBsZWFzdCBvbmUgdGVzdFxuICAgIGlmICghZXhjbHVkZSkge1xuICAgICAgY29uc3QgdW5tYXRjaGVkUGF0dGVybnMgPSByZXF1ZXN0ZWRUZXN0cy5maWx0ZXIocGF0dGVybiA9PiAhZGlzY292ZXJlZFRlc3RzLnNvbWUodCA9PiB0Lm1hdGNoZXMocGF0dGVybikpKTtcbiAgICAgIGZvciAoY29uc3QgdW5tYXRjaGVkIG9mIHVubWF0Y2hlZFBhdHRlcm5zKSB7XG4gICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGBObyBzdWNoIGludGVnIHRlc3Q6ICR7dW5tYXRjaGVkfVxcbmApO1xuICAgICAgfVxuICAgICAgaWYgKHVubWF0Y2hlZFBhdHRlcm5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYEF2YWlsYWJsZSB0ZXN0czogJHtkaXNjb3ZlcmVkVGVzdHMubWFwKHQgPT4gdC5kaXNjb3ZlcnlSZWxhdGl2ZUZpbGVOYW1lKS5qb2luKCcgJyl9XFxuYCk7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYWxsVGVzdHM7XG4gIH1cblxuICAvKipcbiAgICogVGFrZXMgYW4gb3B0aW9uYWwgbGlzdCBvZiB0ZXN0cyB0byBsb29rIGZvciwgb3RoZXJ3aXNlXG4gICAqIGl0IHdpbGwgbG9vayBmb3IgYWxsIHRlc3RzIGZyb20gdGhlIGRpcmVjdG9yeVxuICAgKlxuICAgKiBAcGFyYW0gdGVzdHMgVGVzdHMgdG8gaW5jbHVkZSBvciBleGNsdWRlLCB1bmRlZmluZWQgbWVhbnMgaW5jbHVkZSBhbGwgdGVzdHMuXG4gICAqIEBwYXJhbSBleGNsdWRlIFdoZXRoZXIgdGhlICd0ZXN0cycgbGlzdCBpcyBpbmNsdXNpdmUgb3IgZXhjbHVzaXZlIChpbmNsdXNpdmUgYnkgZGVmYXVsdCkuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGRpc2NvdmVyKG9wdGlvbnM6IEludGVncmF0aW9uVGVzdHNEaXNjb3ZlcnlPcHRpb25zLCBpZ25vcmVVbmNvbXBpbGVkVHlwZVNjcmlwdDogYm9vbGVhbiA9IGZhbHNlKTogUHJvbWlzZTxJbnRlZ1Rlc3RbXT4ge1xuICAgIGNvbnN0IGZpbGVzID0gYXdhaXQgdGhpcy5yZWFkVHJlZSgpO1xuXG4gICAgY29uc3QgdGVzdENhc2VzID0gT2JqZWN0LmVudHJpZXMob3B0aW9ucy50ZXN0Q2FzZXMpXG4gICAgICAuZmxhdE1hcCgoW2FwcENvbW1hbmQsIHBhdHRlcm5zXSkgPT4gZmlsZXNcbiAgICAgICAgLmZpbHRlcihmaWxlTmFtZSA9PiBwYXR0ZXJucy5zb21lKChwYXR0ZXJuKSA9PiB7XG4gICAgICAgICAgY29uc3QgcmVnZXggPSBuZXcgUmVnRXhwKHBhdHRlcm4pO1xuICAgICAgICAgIHJldHVybiByZWdleC50ZXN0KGZpbGVOYW1lKSB8fCByZWdleC50ZXN0KHBhdGguYmFzZW5hbWUoZmlsZU5hbWUpKTtcbiAgICAgICAgfSkpXG4gICAgICAgIC5tYXAoZmlsZU5hbWUgPT4gbmV3IEludGVnVGVzdCh7XG4gICAgICAgICAgZGlzY292ZXJ5Um9vdDogdGhpcy5kaXJlY3RvcnksXG4gICAgICAgICAgZmlsZU5hbWUsXG4gICAgICAgICAgYXBwQ29tbWFuZCxcbiAgICAgICAgfSkpLFxuICAgICAgKTtcblxuICAgIGNvbnN0IGRpc2NvdmVyZWRUZXN0cyA9IGlnbm9yZVVuY29tcGlsZWRUeXBlU2NyaXB0ID8gdGhpcy5maWx0ZXJVbmNvbXBpbGVkVHlwZVNjcmlwdCh0ZXN0Q2FzZXMpIDogdGVzdENhc2VzO1xuXG4gICAgcmV0dXJuIHRoaXMuZmlsdGVyVGVzdHMoZGlzY292ZXJlZFRlc3RzLCBvcHRpb25zLnRlc3RzLCBvcHRpb25zLmV4Y2x1ZGUpO1xuICB9XG5cbiAgcHJpdmF0ZSBmaWx0ZXJVbmNvbXBpbGVkVHlwZVNjcmlwdCh0ZXN0Q2FzZXM6IEludGVnVGVzdFtdKTogSW50ZWdUZXN0W10ge1xuICAgIGNvbnN0IGpzVGVzdENhc2VzID0gdGVzdENhc2VzLmZpbHRlcih0ID0+IHQuZmlsZU5hbWUuZW5kc1dpdGgoJy5qcycpKTtcblxuICAgIHJldHVybiB0ZXN0Q2FzZXNcbiAgICAgIC8vIFJlbW92ZSBhbGwgVHlwZVNjcmlwdCB0ZXN0IGNhc2VzIChlbmRpbmcgaW4gLnRzKVxuICAgICAgLy8gZm9yIHdoaWNoIGEgY29tcGlsZWQgdmVyc2lvbiBpcyBwcmVzZW50IChzYW1lIG5hbWUsIGVuZGluZyBpbiAuanMpXG4gICAgICAuZmlsdGVyKCh0c0NhbmRpZGF0ZSkgPT4ge1xuICAgICAgICBpZiAoIXRzQ2FuZGlkYXRlLmZpbGVOYW1lLmVuZHNXaXRoKCcudHMnKSkge1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBqc1Rlc3RDYXNlcy5maW5kSW5kZXgoanNUZXN0ID0+IGpzVGVzdC50ZXN0TmFtZSA9PT0gdHNDYW5kaWRhdGUudGVzdE5hbWUpID09PSAtMTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkVHJlZSgpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgY29uc3QgcmV0ID0gbmV3IEFycmF5PHN0cmluZz4oKTtcblxuICAgIGFzeW5jIGZ1bmN0aW9uIHJlY3Vyc2UoZGlyOiBzdHJpbmcpIHtcbiAgICAgIGNvbnN0IGZpbGVzID0gYXdhaXQgZnMucmVhZGRpcihkaXIpO1xuICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxQYXRoID0gcGF0aC5qb2luKGRpciwgZmlsZSk7XG4gICAgICAgIGNvbnN0IHN0YXRmID0gYXdhaXQgZnMuc3RhdChmdWxsUGF0aCk7XG4gICAgICAgIGlmIChzdGF0Zi5pc0ZpbGUoKSkge1xuICAgICAgICAgIHJldC5wdXNoKGZ1bGxQYXRoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhdGYuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgIGF3YWl0IHJlY3Vyc2UoZnVsbFBhdGgpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgcmVjdXJzZSh0aGlzLmRpcmVjdG9yeSk7XG4gICAgcmV0dXJuIHJldDtcbiAgfVxufVxuIl19