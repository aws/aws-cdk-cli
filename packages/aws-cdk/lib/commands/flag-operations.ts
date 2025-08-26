import * as os from 'os';
import * as path from 'path';
import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import { formatTable } from '@aws-cdk/cloudformation-diff';
import type { FeatureFlag, Toolkit } from '@aws-cdk/toolkit-lib';
import { CdkAppMultiContext, MemoryContext, DiffMethod } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
// @ts-ignore
import { Select } from 'enquirer';
import * as fs from 'fs-extra';
import PQueue from 'p-queue';
import { StackSelectionStrategy } from '../api';
import type { IoHelper } from '../api-private';
import type { FlagsOptions } from '../cli/user-input';
import { OBSOLETE_FLAGS } from '../obsolete-flags';

enum FlagsMenuOptions {
  ALL_TO_RECOMMENDED = 'Set all flags to recommended values',
  UNCONFIGURED_TO_RECOMMENDED = 'Set unconfigured flags to recommended values',
  UNCONFIGURED_TO_DEFAULT = 'Set unconfigured flags to their implied configuration (record current behavior)',
  MODIFY_SPECIFIC_FLAG = 'Modify a specific flag',
  EXIT = 'Exit',
}

interface executeFlagOperationsOptions extends FlagsOptions {
  app?: string;
}

interface FlagOperationsParams {
  /** User ran --recommended option */
  recommended?: boolean;

  /** User ran --all option */
  all?: boolean;

  /** User provided --value field */
  value?: string;

  /** User provided FLAGNAME field */
  flagName?: string[];

  /** User ran --default option */
  default?: boolean;

  /** User ran --unconfigured option */
  unconfigured?: boolean;

  /** User ran --safe option */
  safe?: boolean;

  /** User provided the number of jobs to run the --safe operation with
   * @default 4
   */
  concurrency?: number;

  /** User provided --app option */
  app?: string;

  /** User ran --interactive option */
  interactive?: boolean;

  /** User ran --set option */
  set?: boolean;
}

export class DetermineSafeFlags {
  private readonly params: FlagOperationsParams;
  private readonly flags: FeatureFlag[];
  private readonly toolkit: Toolkit;
  private readonly ioHelper: IoHelper;
  private app!: string;
  private baseContextValues!: Record<string, any>;
  private allStacks!: CloudFormationStackArtifact[];
  private queue!: PQueue;

  constructor(flagData: FeatureFlag[], ioHelper: IoHelper, options: executeFlagOperationsOptions, toolkit: Toolkit) {
    this.flags = flagData.filter(flag => !OBSOLETE_FLAGS.includes(flag.name)),
    this.toolkit = toolkit;
    this.ioHelper = ioHelper;
    this.params = {
      recommended: options.recommended,
      all: options.all,
      value: options.value,
      flagName: options.FLAGNAME,
      default: options.default,
      unconfigured: options.unconfigured,
      safe: options.safe,
      concurrency: options.concurrency,
      app: options.app,
      interactive: options.interactive,
      set: options.set,
    };
  }

  /**
   * Main entry point for handling flag operations based on user options.
   */
  public async executeFlagOperations(): Promise<void> {
    if (this.flags.length == 0) {
      await this.ioHelper.defaults.error('The \'cdk flags\' command is not compatible with the AWS CDK library used by your application. Please upgrade to 2.212.0 or above.');
      return;
    }

    const interactiveOptions = Object.values(FlagsMenuOptions);

    if (this.params.interactive == true) {
      const prompt = new Select({
        name: 'option',
        message: 'Menu',
        choices: interactiveOptions,
      });

      const answer = await prompt.run();
      if (answer == FlagsMenuOptions.ALL_TO_RECOMMENDED) {
        this.params.recommended = true;
        this.params.all = true;
        await this.setMultipleFlags();
      } else if (answer == FlagsMenuOptions.UNCONFIGURED_TO_RECOMMENDED) {
        this.params.recommended = true;
        this.params.unconfigured = true;
        await this.setMultipleFlags();
      } else if (answer == FlagsMenuOptions.UNCONFIGURED_TO_DEFAULT) {
        this.params.default = true;
        this.params.unconfigured = true;
        await this.setMultipleFlagsIfSupported();
      } else if (answer == FlagsMenuOptions.MODIFY_SPECIFIC_FLAG) {
        await this.setFlag(true);
      } else if (answer == FlagsMenuOptions.EXIT) {
        return;
      }
      return;
    }

    if (this.params.safe) {
      await this.setSafeFlags();
      return;
    }

    if (this.params.flagName && this.params.all) {
      await this.ioHelper.defaults.error('Error: Cannot use both --all and a specific flag name. Please use either --all to show all flags or specify a single flag name.');
      return;
    }

    if ((this.params.value || this.params.recommended || this.params.default || this.params.unconfigured) && !this.params.set) {
      await this.ioHelper.defaults.error('Error: This option can only be used with --set.');
      return;
    }

    if (this.params.value && !this.params.flagName) {
      await this.ioHelper.defaults.error('Error: --value requires a specific flag name. Please specify a flag name when providing a value.');
      return;
    }

    if (this.params.recommended && this.params.default) {
      await this.ioHelper.defaults.error('Error: Cannot use both --recommended and --default. Please choose one option.');
      return;
    }

    if (this.params.unconfigured && this.params.all) {
      await this.ioHelper.defaults.error('Error: Cannot use both --unconfigured and --all. Please choose one option.');
      return;
    }

    if (this.params.unconfigured && this.params.flagName) {
      await this.ioHelper.defaults.error('Error: Cannot use --unconfigured with a specific flag name. --unconfigured works on multiple flags.');
      return;
    }

    if (this.params.set && this.params.flagName && !this.params.value) {
      await this.ioHelper.defaults.error('Error: When setting a specific flag, you must provide a --value.');
      return;
    }

    if (this.params.set && this.params.all && !this.params.recommended && !this.params.default) {
      await this.ioHelper.defaults.error('Error: When using --set with --all, you must specify either --recommended or --default.');
      return;
    }

    if (this.params.set && this.params.unconfigured && !this.params.recommended && !this.params.default) {
      await this.ioHelper.defaults.error('Error: When using --set with --unconfigured, you must specify either --recommended or --default.');
      return;
    }

    if (this.params.flagName && !this.params.set && !this.params.value) {
      await this.displayFlags();
      return;
    }

    if (this.params.all && !this.params.set) {
      await this.displayFlags();
      return;
    }

    if (this.params.set && this.params.flagName && this.params.value) {
      await this.setFlag();
      return;
    }

    if (!this.params.flagName && !this.params.all && !this.params.set) {
      await this.displayFlags();
      return;
    }

    if (this.params.set && this.params.all && this.params.recommended) {
      await this.setMultipleFlags();
      return;
    }

    if (this.params.set && this.params.all && this.params.default) {
      await this.setMultipleFlagsIfSupported();
      }

    if (this.params.set && this.params.unconfigured && this.params.recommended) {
      await this.setMultipleFlags();
      return;
    }

    if (this.params.set && this.params.unconfigured && this.params.default) {
    await setMultipleFlagsIfSupported(params);
  }
}

/**
 * Sets flag configurations to default values if `unconfiguredBehavesLike` is populated
 */
async function setMultipleFlagsIfSupported(params: FlagOperationsParams) {
  const { flagData, ioHelper } = params;
  if (flagData[0].unconfiguredBehavesLike) {
      await this.setMultipleFlags();
      return;
    }
  await ioHelper.defaults.error('The --default options are not compatible with the AWS CDK library used by your application. Please upgrade to 2.212.0 or above.');
  }

  /**
   * Sets a single flag value, either interactively or from provided parameters.
   */
  private async setFlag(interactive?: boolean) {
    const { flagName } = this.params;
    let updatedFlagName = flagName;
    let updatedValue = this.params.value;

    if (interactive) {
      const allFlagNames = this.flags.filter(flag => this.isBooleanFlag(flag) == true).map(flag => flag.name);

      const prompt = new Select({
        name: 'flag',
        message: 'Select which flag you would like to modify:',
        limit: 100,
        choices: allFlagNames,
      });

      const selectedFlagName = await prompt.run();
      updatedFlagName = [selectedFlagName];

      const valuePrompt = new Select({
        name: 'value',
        message: 'Select a value:',
        choices: ['true', 'false'],
      });

      updatedValue = await valuePrompt.run();
      this.params.value = updatedValue;
      this.params.flagName = updatedFlagName;
    } else {
      const flag = this.flags.find(f => f.name === flagName![0]);

      if (!flag) {
        await this.ioHelper.defaults.error('Flag not found.');
        return;
      }

      if (!this.isBooleanFlag(flag)) {
        await this.ioHelper.defaults.error(`Flag '${flagName}' is not a boolean flag. Only boolean flags are currently supported.`);
        return;
      }
    }

    const prototypeSuccess = await this.prototypeChanges(updatedFlagName!);

    if (prototypeSuccess) {
      await this.handleUserResponse(updatedFlagName!);
    }
  }

  /**
   * Identifies and sets flags that can be safely changed without causing template differences.
   */
  private async setSafeFlags(): Promise<void> {
    const { concurrency, app: appOption } = this.params;

    const cdkJson = await JSON.parse(await fs.readFile(path.join(process.cwd(), 'cdk.json'), 'utf-8'));
    this.app = appOption || cdkJson.app;

    const isUsingTsNode = this.app.includes('ts-node');

    if (isUsingTsNode && !this.app.includes('-T') && !this.app.includes('--transpileOnly')) {
      await this.ioHelper.defaults.info('Repeated synths with ts-node will type-check the application on every synth. Add --transpileOnly to cdk.json\'s "app" command to make this operation faster.');
    }

    const unconfiguredFlags = this.flags.filter(flag =>
      flag.userValue === undefined &&
      this.isBooleanFlag(flag) &&
      (flag.unconfiguredBehavesLike?.v2 !== flag.recommendedValue),
    );

    if (unconfiguredFlags.length === 0) {
      await this.ioHelper.defaults.info('All feature flags are configured.');
      return;
    }

    const baseContext = new CdkAppMultiContext(process.cwd());
    this.baseContextValues = await baseContext.read();

    const baselineTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-baseline-'));
    const baseSource = await this.toolkit.fromCdkApp(this.app, {
      contextStore: baseContext,
      outdir: baselineTempDir,
    });

    const baseCx = await this.toolkit.synth(baseSource);
    const baseAssembly = baseCx.cloudAssembly;
    this.allStacks = baseAssembly.stacksRecursively;

    this.queue = new PQueue({ concurrency: concurrency });

    const safeFlags = await this.batchTestFlags(unconfiguredFlags);

    await fs.remove(baselineTempDir);

    if (safeFlags.length > 0) {
      await this.ioHelper.defaults.info('Flags that can be set without template changes:');
      for (const flag of safeFlags) {
        await this.ioHelper.defaults.info(`- ${flag.name} -> ${flag.recommendedValue}`);
      }

      await this.handleUserResponse(safeFlags.map(flag => flag.name));
    } else {
      await this.ioHelper.defaults.info('No more flags can be set without causing template changes.');
    }
  }

  /**
   * Tests all flags together first, then isolates unsafe flags using binary search if needed.
   *
   * @returns array of flags that can be set to recommended values without template changes
   */
  private async batchTestFlags(flags: FeatureFlag[]): Promise<FeatureFlag[]> {
    if (flags.length === 0) {
      return [];
    }

    const allFlagsContext = { ...this.baseContextValues };
    flags.forEach(flag => {
      allFlagsContext[flag.name] = flag.recommendedValue;
    });

    const allSafe = await this.testBatch(allFlagsContext);
    if (allSafe) {
      return flags;
    }

    return this.isolateUnsafeFlags(flags);
  }

  /**
   * Tests if setting flags to given values causes template changes.
   *
   * @returns true if no template changes detected, false otherwise
   */
  private async testBatch(
    contextValues: Record<string, any>,
  ): Promise<boolean> {
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

  /**
   * Uses binary search to identify which flags can be safely set without template changes.
   *
   * @returns array of safe flags that don't cause template changes
   */
  private async isolateUnsafeFlags(flags: FeatureFlag[]): Promise<FeatureFlag[]> {
    const safeFlags: FeatureFlag[] = [];

    async function processBatch(thisRef: DetermineSafeFlags, batch: FeatureFlag[], contextValues: Record<string, any>): Promise<void> {
      if (batch.length === 1) {
        const isSafe = await thisRef.testBatch(
          { ...contextValues, [batch[0].name]: batch[0].recommendedValue },
        );

        if (isSafe) safeFlags.push(batch[0]);
        return;
      }

      const batchContext = { ...contextValues };
      batch.forEach(flag => {
        batchContext[flag.name] = flag.recommendedValue;
      });

      const isSafeBatch = await thisRef.testBatch(batchContext);

      if (isSafeBatch) {
        safeFlags.push(...batch);
        return;
      }

      const mid = Math.floor(batch.length / 2);
      const left = batch.slice(0, mid);
      const right = batch.slice(mid);

      void thisRef.queue.add(() => processBatch(thisRef, left, contextValues));
      void thisRef.queue.add(() => processBatch(thisRef, right, contextValues));
    }

    void this.queue.add(() => processBatch(this, flags, this.baseContextValues));

    await this.queue.onIdle();

    return safeFlags;
  }

  /**
   * Shows a preview of template changes that would result from setting flags.
   */
  private async prototypeChanges(flagNames: string[]): Promise<boolean> {
    const { recommended, value } = this.params;
    const baseContext = new CdkAppMultiContext(process.cwd());
    const baseContextValues = await baseContext.read();
    const memoryContext = new MemoryContext(baseContextValues);

    const cdkJson = await JSON.parse(await fs.readFile(path.join(process.cwd(), 'cdk.json'), 'utf-8'));
    const app = cdkJson.app;

    const source = await this.toolkit.fromCdkApp(app, {
      contextStore: baseContext,
      outdir: fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-original-')),
    });

    const updateObj: Record<string, boolean> = {};
    const boolValue = value === 'true';
    if (flagNames.length === 1 && value !== undefined) {
      const flagName = flagNames[0];
      if (baseContextValues[flagName] == boolValue) {
        await this.ioHelper.defaults.info('Flag is already set to the specified value. No changes needed.');
        return false;
      }
      updateObj[flagName] = boolValue;
    } else {
      for (const flagName of flagNames) {
        const flag = this.flags.find(f => f.name === flagName);
        if (!flag) {
          await this.ioHelper.defaults.error(`Flag ${flagName} not found.`);
          return false;
        }
        const newValue = recommended
          ? flag.recommendedValue as boolean
          : String(flag.unconfiguredBehavesLike?.v2) === 'true';
        updateObj[flagName] = newValue;
      }
    }

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
    return true;
  }

  /**
   * Sets multiple flags to their recommended or default values.
   */
  private async setMultipleFlags() {
    const { all } = this.params;
    let flagsToSet;
    if (all) {
      flagsToSet = this.flags.filter(flag => flag.userValue === undefined || !this.isUserValueEqualToRecommended(flag))
        .filter(flag => this.isBooleanFlag(flag))
        .map(flag => flag.name);
    } else {
      flagsToSet = this.flags.filter(flag =>
        flag.userValue === undefined)
        .filter(flag => this.isBooleanFlag(flag))
        .map(flag => flag.name);
    }
    const prototypeSuccess = await this.prototypeChanges(flagsToSet);

    if (prototypeSuccess) {
      await this.handleUserResponse(flagsToSet);
    }
  }

  /**
   * Prompts user for confirmation and applies flag changes if accepted.
   */
  private async handleUserResponse(flagNames: string[]): Promise<void> {
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
      await this.modifyValues(flagNames);
      await this.ioHelper.defaults.info('Flag value(s) updated successfully.');
    } else {
      await this.ioHelper.defaults.info('Operation cancelled');
    }

    const originalDir = path.join(process.cwd(), 'original');
    const tempDir = path.join(process.cwd(), 'temp');

    await fs.remove(originalDir);
    await fs.remove(tempDir);
  }

  /**
   * Updates cdk.json with new flag values.
   */
  private async modifyValues(flagNames: string[]): Promise<void> {
    const { value, recommended, safe } = this.params;
    const cdkJsonPath = path.join(process.cwd(), 'cdk.json');
    const cdkJsonContent = await fs.readFile(cdkJsonPath, 'utf-8');
    const cdkJson = JSON.parse(cdkJsonContent);

    if (flagNames.length == 1 && !safe) {
      const boolValue = value === 'true';
      cdkJson.context[String(flagNames[0])] = boolValue;

      await this.ioHelper.defaults.info(`Setting flag '${flagNames}' to: ${boolValue}`);
    } else {
      for (const flagName of flagNames) {
        const flag = this.flags.find(f => f.name === flagName);
        const newValue = recommended || safe
          ? flag!.recommendedValue as boolean
          : String(flag!.unconfiguredBehavesLike?.v2) === 'true';
        cdkJson.context[flagName] = newValue;
      }
    }
    await fs.writeFile(cdkJsonPath, JSON.stringify(cdkJson, null, 2), 'utf-8');
  }


  private getFlagSortOrder(flag: FeatureFlag): number {
    if (flag.userValue === undefined) {
      return 3;
    } else if (this.isUserValueEqualToRecommended(flag)) {
      return 1;
    } else {
      return 2;
    }
  }

async function displayFlagTable(flags: FeatureFlag[], ioHelper: IoHelper): Promise<void> {
  const filteredFlags = flags.filter(flag => flag.unconfiguredBehavesLike?.v2 !== flag.recommendedValue);

    const sortedFlags = [...flags].sort((a, b) => {
      const orderA = this.getFlagSortOrder(a);
      const orderB = this.getFlagSortOrder(b);

      if (orderA !== orderB) {
        return orderA - orderB;
      }
      if (a.module !== b.module) {
        return a.module.localeCompare(b.module);
      }
      return a.name.localeCompare(b.name);
    });

  const rows: string[][] = [];
  rows.push(['Feature Flag Name', 'Recommended Value', 'User Value']);
  let currentModule = '';

  sortedFlags.forEach((flag) => {
    if (flag.module !== currentModule) {
      rows.push([chalk.bold(`Module: ${flag.module}`), '', '']);
      currentModule = flag.module;
    }
    rows.push([
      `  ${flag.name}`,
      String(flag.recommendedValue),
      flag.userValue === undefined ? '<unset>' : String(flag.userValue),
    ]);
  });

  const formattedTable = formatTable(rows, undefined, true);
  await ioHelper.defaults.info(formattedTable);
}

  public async displayFlags(): Promise<void> {
    const { flagName, all } = this.params;

    if (flagName && flagName.length > 0) {
      const matchingFlags = this.flags.filter(f =>
        flagName.some(searchTerm => f.name.toLowerCase().includes(searchTerm.toLowerCase())),
      );

      if (matchingFlags.length === 0) {
        await this.ioHelper.defaults.error(`Flag matching "${flagName.join(', ')}" not found.`);
        return;
      }

      if (matchingFlags.length === 1) {
        const flag = matchingFlags[0];
        await this.ioHelper.defaults.info(`Flag name: ${flag.name}`);
        await this.ioHelper.defaults.info(`Description: ${flag.explanation}`);
        await this.ioHelper.defaults.info(`Recommended value: ${flag.recommendedValue}`);
        await this.ioHelper.defaults.info(`User value: ${flag.userValue}`);
        return;
      }

      await this.ioHelper.defaults.info(`Found ${matchingFlags.length} flags matching "${flagName.join(', ')}":`);
      await this.displayFlagTable(matchingFlags, this.ioHelper);
      return;
    }

    let flagsToDisplay: FeatureFlag[];
    if (all) {
      flagsToDisplay = this.flags;
    } else {
      flagsToDisplay = this.flags.filter(flag =>
        flag.userValue === undefined || !this.isUserValueEqualToRecommended(flag),
      );
    }

    await this.displayFlagTable(flagsToDisplay, this.ioHelper);
  }

  private isUserValueEqualToRecommended(flag: FeatureFlag): boolean {
    return String(flag.userValue) === String(flag.recommendedValue);
  }

  private isBooleanFlag(flag: FeatureFlag): boolean {
    const recommended = flag.recommendedValue;
    return typeof recommended === 'boolean' ||
      recommended === 'true' ||
      recommended === 'false';
  }
}

