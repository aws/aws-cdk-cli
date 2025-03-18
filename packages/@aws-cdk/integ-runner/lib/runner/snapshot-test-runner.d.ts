import type { IntegRunnerOptions } from './runner-base';
import { IntegRunner } from './runner-base';
import type { Diagnostic, DestructiveChange, SnapshotVerificationOptions } from '../workers/common';
/**
 * Runner for snapshot tests. This handles orchestrating
 * the validation of the integration test snapshots
 */
export declare class IntegSnapshotRunner extends IntegRunner {
    constructor(options: IntegRunnerOptions);
    /**
     * Synth the integration tests and compare the templates
     * to the existing snapshot.
     *
     * @returns any diagnostics and any destructive changes
     */
    testSnapshot(options?: SnapshotVerificationOptions): {
        diagnostics: Diagnostic[];
        destructiveChanges: DestructiveChange[];
    };
    /**
     * For a given cloud assembly return a collection of all templates
     * that should be part of the snapshot and any required meta data.
     *
     * @param cloudAssemblyDir The directory of the cloud assembly to look for snapshots
     * @param pickStacks Pick only these stacks from the cloud assembly
     * @returns A SnapshotAssembly, the collection of all templates in this snapshot and required meta data
     */
    private getSnapshotAssembly;
    /**
     * For a given stack return all resource types that are allowed to be destroyed
     * as part of a stack update
     *
     * @param stackId the stack id
     * @returns a list of resource types or undefined if none are found
     */
    private getAllowedDestroyTypesForStack;
    /**
     * Find any differences between the existing and expected snapshots
     *
     * @param existing - the existing (expected) snapshot
     * @param actual - the new (actual) snapshot
     * @returns any diagnostics and any destructive changes
     */
    private diffAssembly;
    private readAssembly;
    /**
     * Reduce template to a normal form where asset references have been normalized
     *
     * This makes it possible to compare templates if all that's different between
     * them is the hashes of the asset values.
     */
    private canonicalizeTemplate;
}
