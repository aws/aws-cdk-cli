import type { AssemblyManifest } from '@aws-cdk/cloud-assembly-schema';
import { AssetManifest } from 'cdk-assets/lib/asset-manifest';
/**
 * Trace information for stack
 * map of resource logicalId to trace message
 */
export type StackTrace = Map<string, string>;
/**
 * Trace information for a assembly
 *
 * map of stackId to StackTrace
 */
export type ManifestTrace = Map<string, StackTrace>;
/**
 * Reads a Cloud Assembly manifest
 */
export declare class AssemblyManifestReader {
    private readonly manifest;
    private readonly manifestFileName;
    static readonly DEFAULT_FILENAME = "manifest.json";
    /**
     * Reads a Cloud Assembly manifest from a file
     */
    static fromFile(fileName: string): AssemblyManifestReader;
    /**
     * Reads a Cloud Assembly manifest from a file or a directory
     * If the given filePath is a directory then it will look for
     * a file within the directory with the DEFAULT_FILENAME
     */
    static fromPath(filePath: string): AssemblyManifestReader;
    /**
     * The directory where the manifest was found
     */
    readonly directory: string;
    constructor(directory: string, manifest: AssemblyManifest, manifestFileName: string);
    /**
     * Get the stacks from the manifest
     * returns a map of artifactId to CloudFormation template
     */
    get stacks(): Record<string, any>;
    /**
     * Get the nested stacks for a given stack
     * returns a map of artifactId to CloudFormation template
     */
    getNestedStacksForStack(stackId: string): Record<string, any>;
    /**
     * Write trace data to the assembly manifest metadata
     */
    recordTrace(trace: ManifestTrace): void;
    /**
     * Return a list of assets for a given stack
     */
    getAssetIdsForStack(stackId: string): string[];
    /**
     * For a given stackId return a list of assets that belong to the stack
     */
    getAssetLocationsForStack(stackId: string): string[];
    /**
     * Return a list of asset artifacts for a given stack
     */
    getAssetManifestsForStack(stackId: string): AssetManifest[];
    /**
     * Get a list of assets from the assembly manifest
     */
    private assetsFromAssemblyManifest;
    /**
     * Get a list of assets from the asset manifest
     */
    private assetsFromAssetManifest;
    /**
     * Clean the manifest of any unneccesary data. Currently that includes
     * the metadata trace information since this includes trace information like
     * file system locations and file lines that will change depending on what machine the test is run on
     */
    cleanManifest(): void;
    private renderArtifactMetadata;
    private renderArtifacts;
}
