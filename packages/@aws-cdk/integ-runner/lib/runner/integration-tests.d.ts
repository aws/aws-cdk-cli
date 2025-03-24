/**
 * Represents a single integration test
 *
 * This type is a data-only structure, so it can trivially be passed to workers.
 * Derived attributes are calculated using the `IntegTest` class.
 */
export interface IntegTestInfo {
    /**
     * Path to the file to run
     *
     * Path is relative to the current working directory.
     */
    readonly fileName: string;
    /**
     * The root directory we discovered this test from
     *
     * Path is relative to the current working directory.
     */
    readonly discoveryRoot: string;
    /**
     * The CLI command used to run this test.
     * If it contains {filePath}, the test file names will be substituted at that place in the command for each run.
     *
     * @default - test run command will be `node {filePath}`
     */
    readonly appCommand?: string;
    /**
     * true if this test is running in watch mode
     *
     * @default false
     */
    readonly watch?: boolean;
}
/**
 * Derived information for IntegTests
 */
export declare class IntegTest {
    readonly info: IntegTestInfo;
    /**
     * The name of the file to run
     *
     * Path is relative to the current working directory.
     */
    readonly fileName: string;
    /**
     * Relative path to the file to run
     *
     * Relative from the "discovery root".
     */
    readonly discoveryRelativeFileName: string;
    /**
     * The absolute path to the file
     */
    readonly absoluteFileName: string;
    /**
     * The normalized name of the test. This name
     * will be the same regardless of what directory the tool
     * is run from.
     */
    readonly normalizedTestName: string;
    /**
     * Directory the test is in
     */
    readonly directory: string;
    /**
     * Display name for the test
     *
     * Depends on the discovery directory.
     *
     * Looks like `integ.mytest` or `package/test/integ.mytest`.
     */
    readonly testName: string;
    /**
     * Path of the snapshot directory for this test
     */
    readonly snapshotDir: string;
    /**
     * Path to the temporary output directory for this test
     */
    readonly temporaryOutputDir: string;
    /**
     * The CLI command used to run this test.
     * If it contains {filePath}, the test file names will be substituted at that place in the command for each run.
     *
     * @default - test run command will be `node {filePath}`
     */
    readonly appCommand: string;
    constructor(info: IntegTestInfo);
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
    matches(name: string): boolean;
}
/**
 * Configuration options how integration test files are discovered
 */
export interface IntegrationTestsDiscoveryOptions {
    /**
     * If this is set to true then the list of tests
     * provided will be excluded
     *
     * @default false
     */
    readonly exclude?: boolean;
    /**
     * List of tests to include (or exclude if `exclude=true`)
     *
     * @default - all matched files
     */
    readonly tests?: string[];
    /**
     * A map of of the app commands to run integration tests with,
     * and the regex patterns matching the integration test files each app command.
     *
     * If the app command contains {filePath}, the test file names will be substituted at that place in the command for each run.
     */
    readonly testCases: {
        [app: string]: string[];
    };
}
/**
 * Discover integration tests
 */
export declare class IntegrationTests {
    private readonly directory;
    constructor(directory: string);
    /**
     * Get integration tests discovery options from CLI options
     */
    fromCliOptions(options: {
        app?: string;
        exclude?: boolean;
        language?: string[];
        testRegex?: string[];
        tests?: string[];
    }): Promise<IntegTest[]>;
    /**
     * Get the default configuration for a language
     */
    private getLanguagePreset;
    /**
     * Get the config for all selected languages
     */
    private getLanguagePresets;
    /**
     * If the user provides a list of tests, these can either be a list of tests to include or a list of tests to exclude.
     *
     * - If it is a list of tests to include then we discover all available tests and check whether they have provided valid tests.
     *   If they have provided a test name that we don't find, then we write out that error message.
     * - If it is a list of tests to exclude, then we discover all available tests and filter out the tests that were provided by the user.
     */
    private filterTests;
    /**
     * Takes an optional list of tests to look for, otherwise
     * it will look for all tests from the directory
     *
     * @param tests Tests to include or exclude, undefined means include all tests.
     * @param exclude Whether the 'tests' list is inclusive or exclusive (inclusive by default).
     */
    private discover;
    private filterUncompiledTypeScript;
    private readTree;
}
