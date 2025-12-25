import * as os from 'os';
import * as path from 'path';
import { formatTable } from '@aws-cdk/cloudformation-diff';
import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import type { FeatureFlag, Toolkit } from '@aws-cdk/toolkit-lib';
import { CdkAppMultiContext, MemoryContext, DiffMethod } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import * as fs from 'fs-extra';
import PQueue from 'p-queue';
import { OBSOLETE_FLAGS } from './obsolete-flags';
import type { FlagOperationsParams } from './types';
import { StackSelectionStrategy } from '../../api';
import type { IoHelper } from '../../api-private';

export class FlagOperations {
  /**
   * Returns only those feature flags that need configuration
   *
   * That is those flags:
   * - That are unconfigured
   * - That are not obsolete
   * - Whose default value is different from the recommended value
   *
   * The default value being equal to the recommended value sounds odd, but
   * crops up in a number of situtations:
   *
   * - Security-related fixes that we want to force on people, but want to
   *   give them a flag to back out of the changes if they really need to.
   * - Flags that changed their default value in the most recent major
   *   version.
   * - Flags that we've introduced at some point in the past, but have gone
   *   back on.
   */
  public static filterNeedsAttention(flags: FeatureFlag[]): FeatureFlag[] {
    return flags
      .filter(flag => !OBSOLETE_FLAGS.includes(flag.name))
      .filter(flag => flag.userValue === undefined)
      .filter(flag => defaultValue(flag) !== flag.recommendedValue);
  }

  private app: string;
  private baseContextValues: Record<string, any>;
  private allStacks: CloudFormationStackArtifact[];
  private queue: PQueue;
  private baselineTempDir?: string;

  constructor(
    private readonly flags: FeatureFlag[],
    private readonly toolkit: Toolkit,
    private readonly ioHelper: IoHelper,
    private readonly cliContextValues: Record<string, any> = {},
  ) {
    this.app = '';
    this.baseContextValues = {};
    this.allStacks = [];
    this.queue = new PQueue({ concurrency: 4 });
  }

  /** Main entry point that routes to either flag setting or display operations */
  async execute(params: FlagOperationsParams): Promise<void> {
    if (params.set) {
      if (params.FLAGNAME && params.value) {
        await this.setFlag(params);
      } else {
        await this.setMultipleFlags(params);
      }
    } else {
      await this.displayFlags(params);
    }
  }

  /** Sets a single specific flag with validation and user confirmation */
  async setFlag(params: FlagOperationsParams): Promise<void> {
    const flagName = params.FLAGNAME![0];
    const flag = this.flags.find(f => f.name === flagName);

    if (!flag) {
      await this.ioHelper.defaults.error('Flag not found.');
      return;
    }

    if (!this.isBooleanFlag(flag)) {
      await this.ioHelper.defaults.error(`Flag '${flagName}' is not a boolean flag. Only boolean flags are currently supported.`);
      return;
    }

    const prototypeSuccess = await this.prototypeChanges([flagName], params);
    if (prototypeSuccess) {
      await this.handleUserResponse([flagName], params);
    }
  }

  /** Sets multiple flags (all or unconfigured) with validation and user confirmation */
  async setMultipleFlags(params: FlagOperationsParams): Promise<void> {
    if (params.default && !this.flags.some(f => f.unconfiguredBehavesLike)) {
      await this.ioHelper.defaults.error('The --default options are not compatible with the AWS CDK library used by your application. Please upgrade to 2.212.0 or above.');
      return;
    }

    const flagsToSet = this.getFlagsToSet(params);
    const prototypeSuccess = await this.prototypeChanges(flagsToSet, params);

    if (prototypeSuccess) {
      await this.handleUserResponse(flagsToSet, params);
    }
  }

  /** Determines which flags should be set based on the provided parameters */
  private getFlagsToSet(params: FlagOperationsParams): string[] {
    if (params.all && params.default) {
      return this.flags
        .filter(flag => this.isBooleanFlag(flag))
        .map(flag => flag.name);
    } else if (params.all) {
      return this.flags
        .filter(flag => flag.userValue === undefined || !isEffectiveValueEqualToRecommended(flag))
        .filter(flag => this.isBooleanFlag(flag))
        .map(flag => flag.name);
    } else {
      return this.flags
        .filter(flag => flag.userValue === undefined)
        .filter(flag => this.isBooleanFlag(flag))
        .map(flag => flag.name);
    }
  }

  /** Sets flags that don't cause template changes */
  async setSafeFlags(params: FlagOperationsParams): Promise<void> {
    const cdkJson = await JSON.parse(await fs.readFile(path.join(process.cwd(), 'cdk.json'), 'utf-8'));
    this.app = params.app || cdkJson.app;

    const isUsingTsNode = this.app.includes('ts-node');
    if (isUsingTsNode && !this.app.includes('-T') && !this.app.includes('--transpileOnly')) {
      await this.ioHelper.defaults.info('Repeated synths with ts-node will type-check the application on every synth. Add --transpileOnly to cdk.json\'s "app" command to make this operation faster.');
    }

    const unconfiguredFlags = this.flags.filter(flag =>
      flag.userValue === undefined && this.isBooleanFlag(flag));

    if (unconfiguredFlags.length === 0) {
      await this.ioHelper.defaults.info('All feature flags are configured.');
      return;
    }

    await this.initializeSafetyCheck();
    const safeFlags = await this.batchTestFlags(unconfiguredFlags);
    await this.cleanupSafetyCheck();

    if (safeFlags.length > 0) {
      await this.ioHelper.defaults.info('Flags that can be set without template changes:');
      for (const flag of safeFlags) {
        await this.ioHelper.defaults.info(`- ${flag.name} -> ${flag.recommendedValue}`);
      }
      await this.handleUserResponse(safeFlags.map(flag => flag.name), { ...params, recommended: true });
    } else {
      await this.ioHelper.defaults.info('No more flags can be set without causing template changes.');
    }
  }

  /** Initializes the safety check by reading context and synthesizing baseline templates */
  private async initializeSafetyCheck(): Promise<void> {
    const baseContext = new CdkAppMultiContext(process.cwd());
    this.baseContextValues = { ...await baseContext.read(), ...this.cliContextValues };

    this.baselineTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-baseline-'));
    const mergedContext = new MemoryContext(this.baseContextValues);
    const baseSource = await this.toolkit.fromCdkApp(this.app, {
      contextStore: mergedContext,
      outdir: this.baselineTempDir,
    });

    const baseCx = await this.toolkit.synth(baseSource);
    const baseAssembly = baseCx.cloudAssembly;
    this.allStacks = baseAssembly.stacksRecursively;
    this.queue = new PQueue({ concurrency: 4 });
  }

  /** Cleans up temporary directories created during safety checks */
  private async cleanupSafetyCheck(): Promise<void> {
    if (this.baselineTempDir) {
      await fs.remove(this.baselineTempDir);
      this.baselineTempDir = undefined;
    }
  }

  /** Tests multiple flags together and isolates unsafe ones using binary search */
  private async batchTestFlags(flags: FeatureFlag[]): Promise<FeatureFlag[]> {
    if (flags.length === 0) return [];

    const allFlagsContext = { ...this.baseContextValues };
    flags.forEach(flag => {
      allFlagsContext[flag.name] = flag.recommendedValue;
    });

    const allSafe = await this.testBatch(allFlagsContext);
    if (allSafe) return flags;

    return this.isolateUnsafeFlags(flags);
  }

  /** Tests if a set of context values causes template changes by synthesizing and diffing */
  private async testBatch(contextValues: Record<string, any>): Promise<boolean> {
    const testContext = new MemoryContext(contextValues);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-test-'));
    const testSource = await this.toolkit.fromCdkApp(this.app, {
      contextStore: testContext,
      outdir: tempDir,
    });

    const testCx = await this.toolkit.synth(testSource);

    try {
      for (const stack of this.allStacks) {
        const templatePath = stack.templateFullPath;
        const diff = await this.toolkit.diff(testCx, {
          method: DiffMethod.LocalFile(templatePath),
          stacks: {
            strategy: StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE,
            patterns: [stack.hierarchicalId],
          },
        });

        for (const stackDiff of Object.values(diff)) {
          if (stackDiff.differenceCount > 0) {
            return false;
          }
        }
      }
      return true;
    } finally {
      await fs.remove(tempDir);
    }
  }

  /** Uses binary search to isolate which flags are safe to set without template changes */
  private async isolateUnsafeFlags(flags: FeatureFlag[]): Promise<FeatureFlag[]> {
    const safeFlags: FeatureFlag[] = [];

    const processBatch = async (batch: FeatureFlag[], contextValues: Record<string, any>): Promise<void> => {
      if (batch.length === 1) {
        const isSafe = await this.testBatch(
          { ...contextValues, [batch[0].name]: batch[0].recommendedValue },
        );
        if (isSafe) safeFlags.push(batch[0]);
        return;
      }

      const batchContext = { ...contextValues };
      batch.forEach(flag => {
        batchContext[flag.name] = flag.recommendedValue;
      });

      const isSafeBatch = await this.testBatch(batchContext);
      if (isSafeBatch) {
        safeFlags.push(...batch);
        return;
      }

      const mid = Math.floor(batch.length / 2);
      const left = batch.slice(0, mid);
      const right = batch.slice(mid);

      void this.queue.add(() => processBatch(left, contextValues));
      void this.queue.add(() => processBatch(right, contextValues));
    };

    void this.queue.add(() => processBatch(flags, this.baseContextValues));
    await this.queue.onIdle();
    return safeFlags;
  }

  /** Prototypes flag changes by synthesizing templates and showing diffs to the user */
  private async prototypeChanges(flagNames: string[], params: FlagOperationsParams): Promise<boolean> {
    const baseContext = new CdkAppMultiContext(process.cwd());
    const baseContextValues = { ...await baseContext.read(), ...this.cliContextValues };
    const memoryContext = new MemoryContext(baseContextValues);

    const cdkJson = await JSON.parse(await fs.readFile(path.join(process.cwd(), 'cdk.json'), 'utf-8'));
    const app = cdkJson.app;

    const source = await this.toolkit.fromCdkApp(app, {
      contextStore: memoryContext,
      outdir: fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-original-')),
    });

    const updateObj = await this.buildUpdateObject(flagNames, params, baseContextValues);
    if (!updateObj) return false;

    await memoryContext.update(updateObj);
    const cx = await this.toolkit.synth(source);
    const assembly = cx.cloudAssembly;

    const modifiedSource = await this.toolkit.fromCdkApp(app, {
      contextStore: memoryContext,
      outdir: fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-temp-')),
    });

    const modifiedCx = await this.toolkit.synth(modifiedSource);
    const allStacks = assembly.stacksRecursively;

    for (const stack of allStacks) {
      const templatePath = stack.templateFullPath;
      await this.toolkit.diff(modifiedCx, {
        method: DiffMethod.LocalFile(templatePath),
        stacks: {
          strategy: StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE,
          patterns: [stack.hierarchicalId],
        },
      });
    }

    await this.displayFlagChanges(updateObj, baseContextValues);
    return true;
  }

  /** Displays a summary of flag changes showing old and new values */
  private async displayFlagChanges(updateObj: Record<string, boolean>, baseContextValues: Record<string, any>): Promise<void> {
    await this.ioHelper.defaults.info('\nFlag changes:');
    for (const [flagName, newValue] of Object.entries(updateObj)) {
      const currentValue = baseContextValues[flagName];
      const currentDisplay = currentValue === undefined ? '<unset>' : String(currentValue);
      await this.ioHelper.defaults.info(`  ${flagName}: ${currentDisplay} → ${newValue}`);
    }
  }

  /** Builds the update object with new flag values based on parameters and current context */
  private async buildUpdateObject(flagNames: string[], params: FlagOperationsParams, baseContextValues: Record<string, any>)
    : Promise<Record<string, boolean> | null> {
    const updateObj: Record<string, boolean> = {};

    if (flagNames.length === 1 && params.value !== undefined) {
      const flagName = flagNames[0];
      const boolValue = params.value === 'true';
      if (baseContextValues[flagName] === boolValue) {
        await this.ioHelper.defaults.info('Flag is already set to the specified value. No changes needed.');
        return null;
      }
      updateObj[flagName] = boolValue;
    } else {
      for (const flagName of flagNames) {
        const flag = this.flags.find(f => f.name === flagName);
        if (!flag) {
          await this.ioHelper.defaults.error(`Flag ${flagName} not found.`);
          return null;
        }
        const newValue = params.recommended
          ? flag.recommendedValue as boolean
          : String(defaultValue(flag)) === 'true';
        updateObj[flagName] = newValue;
      }
    }
    return updateObj;
  }

  /** Prompts user for confirmation and applies changes if accepted */
  private async handleUserResponse(flagNames: string[], params: FlagOperationsParams): Promise<void> {
    const userAccepted = await this.ioHelper.requestResponse({
      time: new Date(),
      level: 'info',
      code: 'CDK_TOOLKIT_I9300',
      message: 'Do you want to accept these changes?',
      data: {
        flagNames,
        responseDescription: 'Enter "y" to apply changes or "n" to cancel',
      },
      defaultResponse: false,
    });

    if (userAccepted) {
      await this.modifyValues(flagNames, params);
      await this.ioHelper.defaults.info('Flag value(s) updated successfully.');
    } else {
      await this.ioHelper.defaults.info('Operation cancelled');
    }

    await this.cleanupTempDirectories();
  }

  /** Removes temporary directories created during flag operations */
  private async cleanupTempDirectories(): Promise<void> {
    const originalDir = path.join(process.cwd(), 'original');
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.remove(originalDir);
    await fs.remove(tempDir);
  }

  /** Actually modifies the cdk.json file with the new flag values */
  private async modifyValues(flagNames: string[], params: FlagOperationsParams): Promise<void> {
    const cdkJsonPath = path.join(process.cwd(), 'cdk.json');
    const cdkJsonContent = await fs.readFile(cdkJsonPath, 'utf-8');
    const cdkJson = JSON.parse(cdkJsonContent);

    if (flagNames.length === 1 && !params.safe) {
      const boolValue = params.value === 'true';
      cdkJson.context[String(flagNames[0])] = boolValue;
      await this.ioHelper.defaults.info(`Setting flag '${flagNames}' to: ${boolValue}`);
    } else {
      for (const flagName of flagNames) {
        const flag = this.flags.find(f => f.name === flagName)!;
        const newValue = params.recommended || params.safe
          ? flag.recommendedValue as boolean
          : String(defaultValue(flag)) === 'true';
        cdkJson.context[flagName] = newValue;
      }
    }
    await fs.writeFile(cdkJsonPath, JSON.stringify(cdkJson, null, 2), 'utf-8');
  }

  /** Displays flags in a table format, either specific flags or filtered by criteria */
  async displayFlags(params: FlagOperationsParams): Promise<void> {
    const { FLAGNAME, all } = params;

    if (FLAGNAME && FLAGNAME.length > 0) {
      await this.displaySpecificFlags(FLAGNAME);
      return;
    }

    const [flagsToDisplay, header] = all
      ? [this.flags, 'All feature flags']
      : [FlagOperations.filterNeedsAttention(this.flags), 'Unconfigured feature flags'];

    await this.ioHelper.defaults.info(header);
    await this.displayFlagTable(flagsToDisplay);

    // Add helpful message after empty table when not using --all
    if (!all && flagsToDisplay.length === 0) {
      await this.ioHelper.defaults.info('');
      await this.ioHelper.defaults.info('✅ All feature flags are already set to their recommended values.');
      await this.ioHelper.defaults.info('Use \'cdk flags --all --unstable=flags\' to see all flags and their current values.');
    }
  }

  /** Displays detailed information for specific flags matching the given names */
  private async displaySpecificFlags(flagNames: string[]): Promise<void> {
    const matchingFlags = this.flags.filter(f =>
      flagNames.some(searchTerm => f.name.toLowerCase().includes(searchTerm.toLowerCase())));

    if (matchingFlags.length === 0) {
      await this.ioHelper.defaults.error(`Flag matching "${flagNames.join(', ')}" not found.`);
      return;
    }

    if (matchingFlags.length === 1) {
      const flag = matchingFlags[0];
      await this.ioHelper.defaults.info(`Flag name: ${flag.name}`);
      await this.ioHelper.defaults.info(`Description: ${flag.explanation}`);
      await this.ioHelper.defaults.info(`Recommended value: ${flag.recommendedValue}`);
      await this.ioHelper.defaults.info(`Default value: ${defaultValue(flag)}`);
      await this.ioHelper.defaults.info(`User value: ${flag.userValue}`);
      await this.ioHelper.defaults.info(`Effective value: ${effectiveValue(flag)}`);
      return;
    }

    await this.ioHelper.defaults.info(`Found ${matchingFlags.length} flags matching "${flagNames.join(', ')}"`);
    await this.displayFlagTable(matchingFlags);
  }

  /** Returns sort order for flags */
  private getFlagSortOrder(flag: FeatureFlag): number {
    if (flag.userValue === undefined) return 3;
    if (isEffectiveValueEqualToRecommended(flag)) return 1;
    return 2;
  }

  /** Displays flags in a formatted table grouped by module and sorted */
  async displayFlagTable(flags: FeatureFlag[]): Promise<void> {
    const sortedFlags = [...flags].sort((a, b) => {
      const orderA = this.getFlagSortOrder(a);
      const orderB = this.getFlagSortOrder(b);

      if (orderA !== orderB) return orderA - orderB;
      if (a.module !== b.module) return a.module.localeCompare(b.module);
      return a.name.localeCompare(b.name);
    });

    const rows: string[][] = [['Feature Flag', 'Recommended', 'User', 'Effective']];
    let currentModule = '';

    sortedFlags.forEach((flag) => {
      if (flag.module !== currentModule) {
        rows.push([chalk.bold(`Module: ${flag.module}`), '', '', '']);
        currentModule = flag.module;
      }
      rows.push([
        `  ${flag.name}`,
        String(flag.recommendedValue),
        flag.userValue === undefined ? '<unset>' : String(flag.userValue),
        String(effectiveValue(flag)),
      ]);
    });

    const formattedTable = formatTable(rows, undefined, true);
    await this.ioHelper.defaults.info(formattedTable);
  }

  /** Checks if a flag has a boolean recommended value */
  isBooleanFlag(flag: FeatureFlag): boolean {
    const recommended = flag.recommendedValue;
    return typeof recommended === 'boolean' ||
      recommended === 'true' ||
      recommended === 'false';
  }

  /** Shows helpful usage examples and available command options */
  async displayHelpMessage(): Promise<void> {
    await this.ioHelper.defaults.info('\n' + chalk.bold('Available options:'));
    await this.ioHelper.defaults.info('  cdk flags --interactive     # Interactive menu to manage flags');
    await this.ioHelper.defaults.info('  cdk flags --all             # Show all flags (including configured ones)');
    await this.ioHelper.defaults.info('  cdk flags --set --all --recommended    # Set all flags to recommended values');
    await this.ioHelper.defaults.info('  cdk flags --set --all --default       # Set all flags to default values');
    await this.ioHelper.defaults.info('  cdk flags --set --unconfigured --recommended  # Set unconfigured flags to recommended');
    await this.ioHelper.defaults.info('  cdk flags --set <flag-name> --value <true|false>  # Set specific flag');
    await this.ioHelper.defaults.info('  cdk flags --safe            # Safely set flags that don\'t change templates');
  }
}

/** Checks if the flags current effective value matches the recommended value */
export function isEffectiveValueEqualToRecommended(flag: FeatureFlag): boolean {
  return String(effectiveValue(flag)) === String(flag.recommendedValue);
}

/**
 * Return the effective value of a flag (user value or default)
 */
function effectiveValue(flag: FeatureFlag) {
  return flag.userValue ?? defaultValue(flag);
}

/**
 * Return the default value for a flag, assume it's `false` if not given
 */
function defaultValue(flag: FeatureFlag) {
  return flag.unconfiguredBehavesLike?.v2 ?? false;
}
