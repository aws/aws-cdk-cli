import * as path from 'path';
import type { WritableOptions } from 'stream';
import { Writable } from 'stream';
import { StringDecoder } from 'string_decoder';
import type { ResourceDifference } from '@aws-cdk/cloudformation-diff';
import { fullDiff, formatDifferences, ResourceImpact } from '@aws-cdk/cloudformation-diff';
import type { CdkTestAppOptions, SnapshotAssembly } from './cdk-test-app';
import { CdkTestApp } from './cdk-test-app';
import type { IntegTest } from './integration-tests';
import type { Diagnostic, DestructiveChange, SnapshotVerificationOptions } from '../workers/common';
import { DiagnosticReason } from '../workers/common';

type RunnerOptions = Omit<CdkTestAppOptions, 'outputDirectoryNameTemplate' | 'region'> & {
  /**
   * Only used for testing
   */
  readonly TESTING_compareAgainstDirectory?: string;
};

export type SnapshotResult =
  | { type: 'no-shapshot' }
  | { type: 'did-compare'; diagnostics: Diagnostic[]; destructiveChanges: DestructiveChange[] }
  ;

/**
 * Runner for snapshot tests. This handles orchestrating
 * the validation of the integration test snapshots
 */
export class IntegSnapshotRunner {
  private readonly test: IntegTest;

  constructor(private readonly options: RunnerOptions) {
    this.test = options.test;
  }

  /**
   * Synth the CDK app and compare the templates to the existing snapshot.
   *
   * @returns any diagnostics and any destructive changes
   */
  public async testSnapshot(options: SnapshotVerificationOptions = {}): Promise<SnapshotResult> {
    let cleanApp: CdkTestApp | undefined;
    try {
      // Read expected
      const expected = await CdkTestApp.forGoldenSnapshot(this.options);
      const expectedSuite = await expected.loadExistingSuite();

      if (expectedSuite === undefined) {
        return { type: 'no-shapshot' };
      }

      const expectedSnapshotAssembly = expected.snapshotAssembly(expectedSuite?.stacks);

      // Set up actual
      let actual = await CdkTestApp.forComparison(this.options);
      cleanApp = actual;

      // Special mode for testing, comparing the snapshot to itself.
      if (this.options.TESTING_compareAgainstDirectory) {
        actual = await CdkTestApp.forSpecificDirectory({
          ...this.options,
          outputDirectoryNameTemplate: this.options.TESTING_compareAgainstDirectory,
        });
        cleanApp = undefined;
      }

      // read the "actual" snapshot
      const actualSuite = await actual.synthForSnapshotComparison(expectedSuite.enableLookups ?? true);
      const actualSnapshotAssembly = actual.snapshotAssembly(actualSuite.stacks);

      // diff the existing snapshot (expected) with the integration test (actual)
      const diagnostics = await this.diffAssembly(expectedSnapshotAssembly, actualSnapshotAssembly, actual);

      if (diagnostics.diagnostics.length) {
        // Attach additional messages to the first diagnostic
        const additionalMessages: string[] = [];

        if (options.retain) {
          additionalMessages.push(
            `(Failure retained) Expected: ${path.relative(process.cwd(), expected.outputDirectory)}`,
            `                   Actual:   ${path.relative(process.cwd(), actual.outputDirectory)}`,
          ),
          cleanApp = undefined;
        }

        if (options.verbose) {
          additionalMessages.push(
            'Repro:',
            `  ${actual.synthReproCommand}`,
          );
        }

        Object.assign(diagnostics.diagnostics[0], { additionalMessages });
      }

      return {
        type: 'did-compare',
        diagnostics: diagnostics.diagnostics,
        destructiveChanges: diagnostics.destructiveChanges,
      };
    } catch (e) {
      throw e;
    } finally {
      if (cleanApp) {
        cleanApp.cleanup();
      }
    }
  }

  /**
   * For a given stack return all resource types that are allowed to be destroyed
   * as part of a stack update
   *
   * @param stackId - the stack id
   * @returns a list of resource types or undefined if none are found
   */
  private async getAllowedDestroyTypesForStack(actual: CdkTestApp, stackId: string): Promise<string[] | undefined> {
    for (const testCase of Object.values(actual.testCases())) {
      if (testCase.stacks.includes(stackId)) {
        return testCase.allowDestroy;
      }
    }
    return undefined;
  }

  /**
   * Find any differences between the existing and expected snapshots
   *
   * @param existing - the existing (expected) snapshot
   * @param actual - the new (actual) snapshot
   * @returns any diagnostics and any destructive changes
   */
  private async diffAssembly(
    expected: SnapshotAssembly,
    actual: SnapshotAssembly,
    actualApp: CdkTestApp,
  ): Promise<{ diagnostics: Diagnostic[]; destructiveChanges: DestructiveChange[] }> {
    const failures: Diagnostic[] = [];
    const destructiveChanges: DestructiveChange[] = [];

    // check if there is a CFN template in the current snapshot
    // that does not exist in the "actual" snapshot
    for (const [stackId, stack] of Object.entries(expected)) {
      for (const templateId of Object.keys(stack.templates)) {
        if (!actual[stackId]?.templates[templateId]) {
          failures.push({
            testName: this.test.testName,
            stackName: templateId,
            reason: DiagnosticReason.SNAPSHOT_FAILED,
            message: `${templateId} exists in snapshot, but not in actual`,
          });
        }
      }
    }

    for (const [stackId, stack] of Object.entries(actual)) {
      for (const templateId of Object.keys(stack.templates)) {
      // check if there is a CFN template in the "actual" snapshot
      // that does not exist in the current snapshot
        if (!expected[stackId]?.templates[templateId]) {
          failures.push({
            testName: this.test.testName,
            stackName: templateId,
            reason: DiagnosticReason.SNAPSHOT_FAILED,
            message: `${templateId} does not exist in snapshot, but does in actual`,
          });
          continue;
        } else {
          const config = {
            diffAssets: actualApp.testSuite.getOptionsForStack(stackId)?.diffAssets,
          };
          let actualTemplate = actual[stackId].templates[templateId];
          let expectedTemplate = expected[stackId].templates[templateId];

          // if we are not verifying asset hashes then remove the specific
          // asset hashes from the templates so they are not part of the diff
          // comparison
          if (!config.diffAssets) {
            actualTemplate = this.canonicalizeTemplate(actualTemplate, actual[stackId].assets);
            expectedTemplate = this.canonicalizeTemplate(expectedTemplate, expected[stackId].assets);
          }
          const templateDiff = fullDiff(expectedTemplate, actualTemplate);
          if (!templateDiff.isEmpty) {
            const allowedDestroyTypes = (await this.getAllowedDestroyTypesForStack(actualApp, stackId)) ?? [];

            // go through all the resource differences and check for any
            // "destructive" changes
            templateDiff.resources.forEachDifference((logicalId: string, change: ResourceDifference) => {
            // if the change is a removal it will not show up as a 'changeImpact'
            // so need to check for it separately, unless it is a resourceType that
            // has been "allowed" to be destroyed
              const resourceType = change.oldValue?.Type ?? change.newValue?.Type;
              if (resourceType && allowedDestroyTypes.includes(resourceType)) {
                return;
              }
              if (change.isRemoval) {
                destructiveChanges.push({
                  impact: ResourceImpact.WILL_DESTROY,
                  logicalId,
                  stackName: templateId,
                });
              } else {
                switch (change.changeImpact) {
                  case ResourceImpact.MAY_REPLACE:
                  case ResourceImpact.WILL_ORPHAN:
                  case ResourceImpact.WILL_DESTROY:
                  case ResourceImpact.WILL_REPLACE:
                    destructiveChanges.push({
                      impact: change.changeImpact,
                      logicalId,
                      stackName: templateId,
                    });
                    break;
                }
              }
            });
            const writable = new StringWritable({});
            formatDifferences(writable, templateDiff);
            failures.push({
              reason: DiagnosticReason.SNAPSHOT_FAILED,
              message: writable.data,
              stackName: templateId,
              testName: this.test.testName,
              config,
            });
          }
        }
      }
    }

    return {
      diagnostics: failures,
      destructiveChanges,
    };
  }

  /**
   * Reduce template to a normal form where asset references have been normalized
   *
   * This makes it possible to compare templates if all that's different between
   * them is the hashes of the asset values.
   */
  private canonicalizeTemplate(template: any, assets: string[]): any {
    const assetsSeen = new Set<string>();
    const stringSubstitutions = new Array<[RegExp, string]>();

    // Find assets via parameters (for LegacyStackSynthesizer)
    const paramRe = /^AssetParameters([a-zA-Z0-9]{64})(S3Bucket|S3VersionKey|ArtifactHash)([a-zA-Z0-9]{8})$/;
    for (const paramName of Object.keys(template?.Parameters || {})) {
      const m = paramRe.exec(paramName);
      if (!m) {
        continue;
      }
      if (assetsSeen.has(m[1])) {
        continue;
      }

      assetsSeen.add(m[1]);
      const ix = assetsSeen.size;

      // Full parameter reference
      stringSubstitutions.push([
        new RegExp(`AssetParameters${m[1]}(S3Bucket|S3VersionKey|ArtifactHash)([a-zA-Z0-9]{8})`),
        `Asset${ix}$1`,
      ]);
      // Substring asset hash reference
      stringSubstitutions.push([
        new RegExp(`${m[1]}`),
        `Asset${ix}Hash`,
      ]);
    }

    // find assets defined in the asset manifest
    try {
      assets.forEach(asset => {
        if (!assetsSeen.has(asset)) {
          assetsSeen.add(asset);
          const ix = assetsSeen.size;
          stringSubstitutions.push([
            new RegExp(asset),
            `Asset${ix}$1`,
          ]);
        }
      });
    } catch {
      // if there is no asset manifest that is fine.
    }

    // Substitute them out
    return substitute(template);

    function substitute(what: any): any {
      if (Array.isArray(what)) {
        return what.map(substitute);
      }

      if (typeof what === 'object' && what !== null) {
        const ret: any = {};
        for (const [k, v] of Object.entries(what)) {
          ret[stringSub(k)] = substitute(v);
        }
        return ret;
      }

      if (typeof what === 'string') {
        return stringSub(what);
      }

      return what;
    }

    function stringSub(x: string) {
      for (const [re, replacement] of stringSubstitutions) {
        x = x.replace(re, replacement);
      }
      return x;
    }
  }
}

class StringWritable extends Writable {
  public data: string;
  private _decoder: StringDecoder;
  constructor(options: WritableOptions) {
    super(options);
    this._decoder = new StringDecoder();
    this.data = '';
  }

  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    if (encoding === 'buffer') {
      chunk = this._decoder.write(chunk);
    }

    this.data += chunk;
    callback();
  }

  _final(callback: (error?: Error | null) => void): void {
    this.data += this._decoder.end();
    callback();
  }
}
