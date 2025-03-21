import type { ICdk, ListOptions } from '@aws-cdk/cdk-cli-wrapper';
import type { TestCase, TestOptions } from '@aws-cdk/cloud-assembly-schema';
/**
 * Represents an integration test
 */
export type TestSuite = {
    [testName: string]: TestCase;
};
export type TestSuiteType = 'test-suite' | 'legacy-test-suite';
/**
 * Helper class for working with Integration tests
 * This requires an `integ.json` file in the snapshot
 * directory. For legacy test cases use LegacyIntegTestCases
 */
export declare class IntegTestSuite {
    readonly enableLookups: boolean;
    readonly testSuite: TestSuite;
    readonly synthContext?: {
        [name: string]: string;
    } | undefined;
    /**
     * Loads integ tests from a snapshot directory
     */
    static fromPath(path: string): IntegTestSuite;
    readonly type: TestSuiteType;
    constructor(enableLookups: boolean, testSuite: TestSuite, synthContext?: {
        [name: string]: string;
    } | undefined);
    /**
     * Returns a list of stacks that have stackUpdateWorkflow disabled
     */
    getStacksWithoutUpdateWorkflow(): string[];
    /**
     * Returns test case options for a given stack
     */
    getOptionsForStack(stackId: string): TestOptions | undefined;
    /**
     * Get a list of stacks in the test suite
     */
    get stacks(): string[];
}
/**
 * Options for a reading a legacy test case manifest
 */
export interface LegacyTestCaseConfig {
    /**
     * The name of the test case
     */
    readonly testName: string;
    /**
     * Options to use when performing `cdk list`
     * This is used to determine the name of the stacks
     * in the test case
     */
    readonly listOptions: ListOptions;
    /**
     * An instance of the CDK CLI (e.g. CdkCliWrapper)
     */
    readonly cdk: ICdk;
    /**
     * The path to the integration test file
     * i.e. integ.test.js
     */
    readonly integSourceFilePath: string;
}
/**
 * Helper class for creating an integ manifest for legacy
 * test cases, i.e. tests without a `integ.json`.
 */
export declare class LegacyIntegTestSuite extends IntegTestSuite {
    readonly enableLookups: boolean;
    readonly testSuite: TestSuite;
    readonly synthContext?: {
        [name: string]: string;
    } | undefined;
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
    static fromLegacy(config: LegacyTestCaseConfig): LegacyIntegTestSuite;
    static getPragmaContext(integSourceFilePath: string): Record<string, any>;
    /**
     * Reads stack names from the "!cdk-integ" pragma.
     *
     * Every word that's NOT prefixed by "pragma:" is considered a stack name.
     *
     * @example
     *
     *    /// !cdk-integ <stack-name>
     */
    private static readStackPragma;
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
    private static readIntegPragma;
    /**
     * Return the non-stack pragmas
     *
     * These are all pragmas that start with "pragma:".
     *
     * For backwards compatibility reasons, all pragmas that DON'T start with this
     * string are considered to be stack names.
     */
    private static pragmas;
    readonly type: TestSuiteType;
    constructor(enableLookups: boolean, testSuite: TestSuite, synthContext?: {
        [name: string]: string;
    } | undefined);
    /**
     * Save the integ manifest to a directory
     */
    saveManifest(directory: string, context?: Record<string, any>): void;
}
