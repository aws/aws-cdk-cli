import * as path from 'path';
import type { FeatureFlag, Toolkit } from '@aws-cdk/toolkit-lib';
import { CdkAppMultiContext, MemoryContext, DiffMethod } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
// @ts-ignore
import { Select } from 'enquirer';
import * as fs from 'fs-extra';
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

/**
 * Parameters for the flags command operations. 
 * Parameters are set according to the command the user runs.
 */

interface FlagOperationsParams {
  flagData: FeatureFlag[];
  toolkit: Toolkit;
  ioHelper: IoHelper;

  /**
   * Whether or not the user ran the --recommended option.
   */
  recommended?: boolean;
  
  /**
   * Whether or not the user ran the --all option.
   */
  all?: boolean;

  /**
   * Whether or not the user added a --value field.
   */
  value?: string;

  /**
   * Whether or not the user added a FLAGNAME field.
   */
  flagName?: string[];

  /**
   * Whether or not the user ran the --default option.
   */
  default?: boolean;

  /**
   * Whether or not the user ran the --unconfigured option.
   */
  unconfigured?: boolean;
}

export async function handleFlags(flagData: FeatureFlag[], ioHelper: IoHelper, options: FlagsOptions, toolkit: Toolkit) {
  flagData = flagData.filter(flag => !OBSOLETE_FLAGS.includes(flag.name));
  let params = {
    flagData,
    toolkit,
    ioHelper,
    recommended: options.recommended,
    all: options.all,
    value: options.value,
    flagName: options.FLAGNAME,
    default: options.default,
    unconfigured: options.unconfigured,
  };

  const interactiveOptions = Object.values(FlagsMenuOptions);

  if (options.interactive) {
    const prompt = new Select({
      name: 'option',
      message: 'Menu',
      choices: interactiveOptions,
    });

    const answer = await prompt.run();
    if (answer == FlagsMenuOptions.ALL_TO_RECOMMENDED) {
      params = {
        ...params,
        recommended: true,
        all: true,
      };
      await setMultipleFlags(params);
    } else if (answer == FlagsMenuOptions.UNCONFIGURED_TO_RECOMMENDED) {
      params = {
        ...params,
        recommended: true,
        unconfigured: true,
      };
      await setMultipleFlags(params);
    } else if (answer == FlagsMenuOptions.UNCONFIGURED_TO_DEFAULT) {
      params = {
        ...params,
        default: true,
        unconfigured: true,
      };
      await setMultipleFlags(params);
    } else if (answer == FlagsMenuOptions.MODIFY_SPECIFIC_FLAG) {
      await setFlag(params, true);
    } else if (answer == FlagsMenuOptions.EXIT) {
      return;
    }
    return;
  }

  if (options.FLAGNAME && options.all) {
    await ioHelper.defaults.error('Error: Cannot use both --all and a specific flag name. Please use either --all to show all flags or specify a single flag name.');
    return;
  }

  if ((options.value || options.recommended || options.default || options.unconfigured) && !options.set) {
    await ioHelper.defaults.error('Error: This option can only be used with --set.');
    return;
  }

  if (options.value && !options.FLAGNAME) {
    await ioHelper.defaults.error('Error: --value requires a specific flag name. Please specify a flag name when providing a value.');
    return;
  }

  if (options.recommended && options.default) {
    await ioHelper.defaults.error('Error: Cannot use both --recommended and --default. Please choose one option.');
    return;
  }

  if (options.unconfigured && options.all) {
    await ioHelper.defaults.error('Error: Cannot use both --unconfigured and --all. Please choose one option.');
    return;
  }

  if (options.unconfigured && options.FLAGNAME) {
    await ioHelper.defaults.error('Error: Cannot use --unconfigured with a specific flag name. --unconfigured works on multiple flags.');
    return;
  }

  if (options.set && options.FLAGNAME && !options.value) {
    await ioHelper.defaults.error('Error: When setting a specific flag, you must provide a --value.');
    return;
  }

  if (options.set && options.all && !options.recommended && !options.default) {
    await ioHelper.defaults.error('Error: When using --set with --all, you must specify either --recommended or --default.');
    return;
  }

  if (options.set && options.unconfigured && !options.recommended && !options.default) {
    await ioHelper.defaults.error('Error: When using --set with --unconfigured, you must specify either --recommended or --default.');
    return;
  }

  if (options.FLAGNAME && !options.set && !options.value) {
    await displayFlags(params);
    return;
  }

  if (options.all && !options.set) {
    await displayFlags(params);
    return;
  }

  if (options.set && options.FLAGNAME && options.value) {
    await setFlag(params);
    return;
  }

  if (!options.FLAGNAME && !options.all && !options.set) {
    await displayFlags(params);
    return;
  }

  if (options.set && options.all && options.recommended) {
    await setMultipleFlags(params);
    return;
  }

  if (options.set && options.all && options.default) {
    await setMultipleFlags(params);
    return;
  }

  if (options.set && options.unconfigured && options.recommended) {
    await setMultipleFlags(params);
    return;
  }

  if (options.set && options.unconfigured && options.default) {
    await setMultipleFlags(params);
    return;
  }
}

async function setFlag(params: FlagOperationsParams, interactive?: boolean) {
  const { flagData, ioHelper, flagName } = params;
  let updatedParams = params;
  let updatedFlagName = flagName;

  if (interactive) {
    const allFlagNames = flagData.filter(flag => isBooleanFlag(flag) == true).map(flag => flag.name);

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

    const updatedValue = await valuePrompt.run();

    updatedParams = {
      ...params,
      value: updatedValue,
      flagName: updatedFlagName,
    };
  } else {
    const flag = flagData.find(f => f.name === flagName![0]);

    if (!flag) {
      await ioHelper.defaults.error('Flag not found.');
      return;
    }

    if (!isBooleanFlag(flag)) {
      await ioHelper.defaults.error(`Flag '${flagName}' is not a boolean flag. Only boolean flags are currently supported.`);
      return;
    }
  }

  const prototypeSuccess = await prototypeChanges(updatedParams, updatedFlagName!);

  if (prototypeSuccess) {
    await handleUserResponse(updatedParams, updatedFlagName!);
  }
}

async function prototypeChanges(
  params: FlagOperationsParams,
  flagNames: string[],
): Promise<boolean> {
  const { flagData, toolkit, ioHelper, recommended, value } = params;
  const baseContext = new CdkAppMultiContext(process.cwd());
  const baseContextValues = await baseContext.read();
  const memoryContext = new MemoryContext(baseContextValues);

  const cdkJson = await JSON.parse(await fs.readFile(path.join(process.cwd(), 'cdk.json'), 'utf-8'));
  const app = cdkJson.app;

  const source = await toolkit.fromCdkApp(app, {
    contextStore: baseContext,
    outdir: path.join(process.cwd(), 'original'),
  });

  const updateObj: Record<string, boolean> = {};
  const boolValue = toBooleanValue(value);
  if (flagNames.length === 1 && value !== undefined) {
    const flagName = flagNames[0];
    if (baseContextValues[flagName] == boolValue) {
      await ioHelper.defaults.info('Flag is already set to the specified value. No changes needed.');
      return false;
    }
    updateObj[flagName] = boolValue;
  } else {
    for (const flagName of flagNames) {
      const flag = flagData.find(f => f.name === flagName);
      if (!flag) {
        await ioHelper.defaults.error(`Flag ${flagName} not found.`);
        return false;
      }
      const newValue = recommended
        ? toBooleanValue(flag.recommendedValue)
        : String(flag.unconfiguredBehavesLike?.v2) === 'true';
      updateObj[flagName] = newValue;
    }
  }

  await memoryContext.update(updateObj);
  const cx = await toolkit.synth(source);
  const assembly = cx.cloudAssembly;

  const modifiedSource = await toolkit.fromCdkApp(app, {
    contextStore: memoryContext,
    outdir: path.join(process.cwd(), 'temp'),
  });

  const modifiedCx = await toolkit.synth(modifiedSource);
  const allStacks = assembly.stacksRecursively;

  for (const stack of allStacks) {
    const templatePath = stack.templateFullPath;
    await toolkit.diff(modifiedCx, {
      method: DiffMethod.LocalFile(templatePath),
      stacks: {
        strategy: StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE,
        patterns: [stack.hierarchicalId],
      },
    });
  }
  return true;
}

async function setMultipleFlags(params: FlagOperationsParams) {
  const { flagData, all } = params;
  let flagsToSet;
  if (all) {
    flagsToSet = flagData.filter(flag => flag.userValue === undefined || !isUserValueEqualToRecommended(flag))
      .filter(flag => isBooleanFlag(flag))
      .map(flag => flag.name);
  } else {
    flagsToSet = flagData.filter(flag =>
      flag.userValue === undefined)
      .filter(flag => isBooleanFlag(flag))
      .map(flag => flag.name);
  }
  const prototypeSuccess = await prototypeChanges(params, flagsToSet);

  if (prototypeSuccess) {
    await handleUserResponse(params, flagsToSet);
  }
}

async function handleUserResponse(
  params: FlagOperationsParams,
  flagNames: string[],
): Promise<void> {
  const { ioHelper } = params;
  const userAccepted = await ioHelper.requestResponse({
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
    await modifyValues(params, flagNames);
    await ioHelper.defaults.info('Flag value(s) updated successfully.');
  } else {
    await ioHelper.defaults.info('Operation cancelled');
  }

  const originalDir = path.join(process.cwd(), 'original');
  const tempDir = path.join(process.cwd(), 'temp');

  await fs.remove(originalDir);
  await fs.remove(tempDir);
}

async function modifyValues(params: FlagOperationsParams, flagNames: string[]): Promise<void> {
  const { flagData, ioHelper, value, recommended } = params;
  const cdkJsonPath = path.join(process.cwd(), 'cdk.json');
  const cdkJsonContent = await fs.readFile(cdkJsonPath, 'utf-8');
  const cdkJson = JSON.parse(cdkJsonContent);

  if (flagNames.length == 1) {
    const boolValue = toBooleanValue(value);
    cdkJson.context[String(flagNames[0])] = boolValue;

    await ioHelper.defaults.info(`Setting flag '${flagNames}' to: ${boolValue}`);
  } else {
    for (const flagName of flagNames) {
      const flag = flagData.find(f => f.name === flagName);
      const newValue = recommended
        ? toBooleanValue(flag!.recommendedValue)
        : String(flag!.unconfiguredBehavesLike?.v2) === 'true';
      cdkJson.context[flagName] = newValue;
    }
  }

  await fs.writeFile(cdkJsonPath, JSON.stringify(cdkJson, null, 2), 'utf-8');
}

function formatTable(headers: string[], rows: string[][]): string {
  const columnWidths = [
    Math.max(headers[0].length, ...rows.map(row => row[0].length)),
    Math.max(headers[1].length, ...rows.map(row => row[1].length)),
    Math.max(headers[2].length, ...rows.map(row => row[2].length)),
  ];

  const createSeparator = () => {
    return '+' + columnWidths.map(width => '-'.repeat(width + 2)).join('+') + '+';
  };

  const formatRow = (values: string[]) => {
    return '|' + values.map((value, i) => ` ${value.padEnd(columnWidths[i])} `).join('|') + '|';
  };

  const separator = createSeparator();
  let table = separator + '\n';
  table += formatRow(headers) + '\n';
  table += separator + '\n';

  rows.forEach(row => {
    if (row[1] === '' && row[2] === '') {
      table += ` ${row[0].padEnd(columnWidths[0])} \n`;
    } else {
      table += formatRow(row) + '\n';
    }
  });

  table += separator;
  return table;
}

function getFlagSortOrder(flag: FeatureFlag): number {
  if (flag.userValue === undefined) {
    return 3;
  } else if (isUserValueEqualToRecommended(flag)) {
    return 1;
  } else {
    return 2;
  }
}

async function displayFlagTable(flags: FeatureFlag[], ioHelper: IoHelper): Promise<void> {
  const headers = ['Feature Flag Name', 'Recommended Value', 'User Value'];

  const sortedFlags = [...flags].sort((a, b) => {
    const orderA = getFlagSortOrder(a);
    const orderB = getFlagSortOrder(b);

    if (orderA !== orderB) {
      return orderA - orderB;
    }
    if (a.module !== b.module) {
      return a.module.localeCompare(b.module);
    }
    return a.name.localeCompare(b.name);
  });

  const rows: string[][] = [];
  let currentModule = '';

  sortedFlags.forEach((flag) => {
    if (flag.module !== currentModule) {
      rows.push([chalk.bold(`Module: ${flag.module}`), '', '']);
      currentModule = flag.module;
    }
    rows.push([
      flag.name,
      String(flag.recommendedValue),
      flag.userValue === undefined ? '<unset>' : String(flag.userValue),
    ]);
  });

  const formattedTable = formatTable(headers, rows);
  await ioHelper.defaults.info(formattedTable);
}

export async function displayFlags(params: FlagOperationsParams): Promise<void> {
  const { flagData, ioHelper, flagName, all } = params;

  if (flagName && flagName.length > 0) {
    const searchTerm = flagName[0];
    const matchingFlags = flagData.filter(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()));

    if (matchingFlags.length === 0) {
      await ioHelper.defaults.error(`Flag matching "${searchTerm}" not found.`);
      return;
    }

    if (matchingFlags.length === 1) {
      const flag = matchingFlags[0];
      await ioHelper.defaults.info(`Flag name: ${flag.name}`);
      await ioHelper.defaults.info(`Description: ${flag.explanation}`);
      await ioHelper.defaults.info(`Recommended value: ${flag.recommendedValue}`);
      await ioHelper.defaults.info(`User value: ${flag.userValue}`);
      return;
    }

    await ioHelper.defaults.info(`Found ${matchingFlags.length} flags matching "${searchTerm}":`);
    await displayFlagTable(matchingFlags, ioHelper);
    return;
  }

  let flagsToDisplay: FeatureFlag[];
  if (all) {
    flagsToDisplay = flagData;
  } else {
    flagsToDisplay = flagData.filter(flag =>
      flag.userValue === undefined || !isUserValueEqualToRecommended(flag),
    );
  }

  await displayFlagTable(flagsToDisplay, ioHelper);
}

function isUserValueEqualToRecommended(flag: FeatureFlag): boolean {
  return String(flag.userValue) === String(flag.recommendedValue);
}

function toBooleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return false;
}

function isBooleanFlag(flag: FeatureFlag): boolean {
  const recommended = flag.recommendedValue;
  return typeof recommended === 'boolean' ||
    recommended === 'true' ||
    recommended === 'false';
}
