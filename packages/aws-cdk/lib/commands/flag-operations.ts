import * as path from 'path';
import type { FeatureFlag, Toolkit } from '@aws-cdk/toolkit-lib';
import { CdkAppMultiContext, MemoryContext, DiffMethod } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import * as fs from 'fs-extra';
import { StackSelectionStrategy } from '../api';
import type { IoHelper } from '../api-private';
import type { FlagsOptions } from '../cli/user-input';

export async function handleFlags(flagData: FeatureFlag[], ioHelper: IoHelper, options: FlagsOptions, toolkit: Toolkit) {
  const OBSOLETE_FLAGS = [
    '@aws-cdk/core:enableStackNameDuplicates',
    '@aws-cdk/aws-s3:grantWriteWithoutAcl',
    '@aws-cdk/aws-kms:defaultKeyPolicies',
  ];

  flagData = flagData.filter(flag => !OBSOLETE_FLAGS.includes(flag.name));

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
    await displayFlags(flagData, ioHelper, String(options.FLAGNAME));
    return;
  }

  if (options.all && !options.set) {
    await displayFlags(flagData, ioHelper, undefined, true);
    return;
  }

  if (options.set && options.FLAGNAME && options.value) {
    await setFlag(flagData, ioHelper, String(options.FLAGNAME), toolkit, options.value);
    return;
  }

  if (!options.FLAGNAME && !options.all && !options.set) {
    await displayFlags(flagData, ioHelper, undefined, false);
    return;
  }

  if (options.set && options.all && options.recommended) {
    await setMultipleFlags(true, flagData, ioHelper, toolkit, true);
    return;
  }

  if (options.set && options.all && options.default) {
    await setMultipleFlags(true, flagData, ioHelper, toolkit, false);
    return;
  }

  if (options.set && options.unconfigured && options.recommended) {
    await setMultipleFlags(false, flagData, ioHelper, toolkit, true);
    return;
  }

  if (options.set && options.unconfigured && options.default) {
    await setMultipleFlags(false, flagData, ioHelper, toolkit, false);
    return;
  }
}

async function setFlag(flagData: FeatureFlag[], ioHelper: IoHelper, flagName: string, toolkit: Toolkit, value: string) {
  const flag = flagData.find(f => f.name === flagName);
  const boolValue = toBooleanValue(value);

  if (!flag) {
    await ioHelper.defaults.error('Flag not found.');
    return;
  }

  if (!isBooleanFlag(flag)) {
    await ioHelper.defaults.error(`Flag '${flagName}' is not a boolean flag. Only boolean flags are currently supported.`);
    return;
  }

  const prototypeSuccess = await prototypeChanges(flagData, ioHelper, flagName, toolkit, false, boolValue);

  if (prototypeSuccess) {
    await handleUserResponse(flagData, ioHelper, flagName, value);
  }
}

async function prototypeChanges(
  flagData: FeatureFlag[],
  ioHelper: IoHelper,
  flagNames: string[] | string,
  toolkit: Toolkit,
  recommended: boolean,
  value?: boolean,
): Promise<boolean> {
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
  if (typeof (flagNames) == 'string') {
    if (baseContextValues[flagNames] == value) {
      await ioHelper.defaults.error('Flag is already set to the specified value. No changes needed.');
      return false;
    }
    updateObj[flagNames] = value!;
  } else {
    if (recommended) {
      for (const flagName of flagNames) {
        const flag = flagData.find(f => f.name === flagName);
        const boolValue = toBooleanValue(flag!.recommendedValue);
        updateObj[flagName] = boolValue;
      }
    } else {
      // In this case, set the flag to its default behavior. Will be updated when we can access the `unconfiguredBehavesLike` field in the feature flag report.
      for (const flagName of flagNames) {
        updateObj[flagName] = false;
      }
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

async function setMultipleFlags(all: boolean, flagData: FeatureFlag[], ioHelper: IoHelper, toolkit: Toolkit, recommended: boolean) {
  let flagsToSet;
  if (all) {
    flagsToSet = flagData.filter(flag => flag.userValue === undefined || String(flag.userValue) !== String(flag.recommendedValue))
      .filter(flag => isBooleanFlag(flag))
      .map(flag => flag.name);
  } else {
    flagsToSet = flagData.filter(flag =>
      flag.userValue === undefined)
      .filter(flag => isBooleanFlag(flag))
      .map(flag => flag.name);
  }
  let prototypeSuccess = false;

  if (recommended) {
    prototypeSuccess = await prototypeChanges(flagData, ioHelper, flagsToSet, toolkit, true);
  } else {
    prototypeSuccess = await prototypeChanges(flagData, ioHelper, flagsToSet, toolkit, false);
  }

  if (prototypeSuccess) {
    await handleUserResponse(flagData, ioHelper, flagsToSet);
  }
}

async function handleUserResponse(
  flagsData: FeatureFlag[],
  ioHelper: IoHelper,
  flagName: string[] | string,
  newValue?: string,
): Promise<void> {
  const userAccepted = await ioHelper.requestResponse({
    time: new Date(),
    level: 'info',
    code: 'CDK_TOOLKIT_I9300',
    message: 'Do you want to accept these changes?',
    data: {
      flagName,
      responseDescription: 'Enter "y" to apply changes or "n" to cancel',
    },
    defaultResponse: false,
  });
  if (userAccepted) {
    await modifyValues(flagsData, flagName, ioHelper, newValue);
    await ioHelper.defaults.info('Flag value(s) updated successfully.');
  } else {
    await ioHelper.defaults.info('Operation cancelled');
  }

  const originalDir = path.join(process.cwd(), 'original');
  const tempDir = path.join(process.cwd(), 'temp');

  await fs.remove(originalDir);
  await fs.remove(tempDir);
}

async function modifyValues(flagsData: FeatureFlag[], flagName: string | string[], ioHelper: IoHelper, value?: string): Promise<void> {
  const cdkJsonPath = path.join(process.cwd(), 'cdk.json');
  const cdkJsonContent = await fs.readFile(cdkJsonPath, 'utf-8');
  const cdkJson = JSON.parse(cdkJsonContent);

  if (typeof flagName == 'string') {
    const boolValue = toBooleanValue(value);
    cdkJson.context[flagName] = boolValue;

    await ioHelper.defaults.info(`Setting flag '${flagName}' to: ${boolValue}`);
  } else {
    for (const name of flagName) {
      const flag = flagsData.find(f => f.name === name);
      const boolValue = toBooleanValue(flag!.recommendedValue);
      cdkJson.context[name] = boolValue;
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

export async function displayFlags(flagsData: FeatureFlag[], ioHelper: IoHelper, flagName?: string, all?: boolean): Promise<void> {
  if (flagName && flagName.length > 0) {
    const flag = flagsData.find(f => f.name === flagName);
    if (!flag) {
      await ioHelper.defaults.error('Flag not found.');
      return;
    }

    await ioHelper.defaults.info(`Description: ${flag.explanation}`);
    await ioHelper.defaults.info(`Recommended value: ${flag.recommendedValue}`);
    await ioHelper.defaults.info(`User value: ${flag.userValue}`);
    return;
  }

  const headers = ['Feature Flag Name', 'Recommended Value', 'User Value'];
  const rows: string[][] = [];

  const getFlagPriority = (flag: FeatureFlag): number => {
    if (flag.userValue === undefined) {
      return 3;
    } else if (String(flag.userValue) === String(flag.recommendedValue)) {
      return 1;
    } else {
      return 2;
    }
  };

  let flagsToDisplay: FeatureFlag[];
  if (all) {
    flagsToDisplay = flagsData;
  } else {
    flagsToDisplay = flagsData.filter(flag =>
      flag.userValue === undefined || String(flag.userValue) !== String(flag.recommendedValue),
    );
  }

  const sortedFlags = [...flagsToDisplay].sort((a, b) => {
    const priorityA = getFlagPriority(a);
    const priorityB = getFlagPriority(b);

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    if (a.module !== b.module) {
      return a.module.localeCompare(b.module);
    }
    return a.name.localeCompare(b.name);
  });

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
