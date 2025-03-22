import type { IntegManifest, TestCase } from '@aws-cdk/cloud-assembly-schema';
/**
 * Test case configuration read from the integ manifest
 */
export interface IntegTestConfig {
    /**
     * Test cases contained in this integration test
     */
    readonly testCases: {
        [testCaseName: string]: TestCase;
    };
    /**
     * Whether to enable lookups for this test
     *
     * @default false
     */
    readonly enableLookups: boolean;
    /**
     * Additional context to use when performing
     * a synth. Any context provided here will override
     * any default context
     *
     * @default - no additional context
     */
    readonly synthContext?: {
        [name: string]: string;
    };
}
/**
 * Reads an integration tests manifest
 */
export declare class IntegManifestReader {
    private readonly manifest;
    static readonly DEFAULT_FILENAME = "integ.json";
    /**
     * Reads an integration test manifest from the specified file
     */
    static fromFile(fileName: string): IntegManifestReader;
    /**
     * Reads a Integration test manifest from a file or a directory
     * If the given filePath is a directory then it will look for
     * a file within the directory with the DEFAULT_FILENAME
     */
    static fromPath(filePath: string): IntegManifestReader;
    /**
     * The directory where the manifest was found
     */
    readonly directory: string;
    constructor(directory: string, manifest: IntegManifest);
    /**
     * List of integration tests in the manifest
     */
    get tests(): IntegTestConfig;
}
