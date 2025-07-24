import * as path from 'path';
import type { FeatureFlag, Toolkit } from '@aws-cdk/toolkit-lib';
import { CdkAppMultiContext, MemoryContext, DiffMethod } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import * as fs from 'fs-extra';
import { StackSelectionStrategy } from '../api';
import type { IoHelper } from '../api-private';
import type { FlagsOptions } from '../cli/user-input';

export async function handleFlags(flagData: FeatureFlag[], ioHelper: IoHelper, options: FlagsOptions, toolkit: Toolkit) {
  if (options.FLAGNAME && options.all) {
    await ioHelper.defaults.info('Error: Cannot use both --all and a specific flag name. Please use either --all to show all flags or specify a single flag name.');
    return;
  }

  if (options.set && options.all) {
    await ioHelper.defaults.info('Error: --set is currently only compatible with a flag name. Please specify which flag you want to set.');
    return;
  }

  if (options.set && !options.FLAGNAME) {
    await ioHelper.defaults.info('Error: --set requires a flag name. Please specify which flag you want to set.');
    return;
  }

  if (options.set && !options.value) {
    await ioHelper.defaults.info('Error: --set requires a value. Please specify the value you want to set for the flag.');
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

  if (options.set && options.FLAGNAME || options.value && options.FLAGNAME) {
    await prototypeChanges(flagData, ioHelper, String(options.FLAGNAME), options.value, toolkit);
    return;
  }

  if (!options.FLAGNAME && !options.all && !options.set) {
    await displayFlags(flagData, ioHelper, undefined, false);
  }
}

export async function displayFlags(flagsData: FeatureFlag[], ioHelper: IoHelper, flagName?: string, all?: boolean): Promise<void> {
  if (flagName && flagName.length > 0) {
    const flag = flagsData.find(f => f.name === flagName);
    if (!flag) {
      await ioHelper.defaults.info('Flag not found.');
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

async function prototypeChanges(
  flagData: FeatureFlag[],
  ioHelper: IoHelper,
  flagName: string,
  value: string | undefined,
  toolkit: Toolkit,
) {
  const flag = flagData.find(f => f.name === flagName);
  if (!flag) {
    await ioHelper.defaults.info('Flag not found.');
    return;
  }

  if (typeof flag.recommendedValue !== 'boolean' && flag.recommendedValue !== 'true' && flag.recommendedValue !== 'false') {
    await ioHelper.defaults.info(`Flag '${flagName}' is not a boolean flag. Only boolean flags are currently supported.`);
    return;
  }

  const baseContext = new CdkAppMultiContext(process.cwd());
  const baseContextValues = await baseContext.read();
  const memoryContext = new MemoryContext(baseContextValues);

  const boolValue = value!.toLowerCase() === 'true';

  if (baseContextValues[flagName] == boolValue) {
    await ioHelper.defaults.info('Flag is already set to the specified value. No changes needed.');
    return;
  }
  const cdkJson = await JSON.parse(await fs.readFile(path.join(process.cwd(), 'cdk.json'), 'utf-8'));
  const app = cdkJson.app;

  const source = await toolkit.fromCdkApp(app, {
    contextStore: baseContext,
    outdir: path.join(process.cwd(), 'original'),
  });

  const cx = await toolkit.synth(source);
  const assembly = cx.cloudAssembly;

  const updateObj: Record<string, boolean> = {};
  updateObj[flagName] = boolValue;
  await memoryContext.update(updateObj);

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

  const userAccepted = await promptUser(
    ioHelper,
    flagName,
    flag.userValue,
    value?.toLowerCase() === 'true',
  );

  if (userAccepted) {
    await modifyValues(flagName, value!, ioHelper);
    await ioHelper.defaults.info('Flag value updated successfully.');
  } else {
    await ioHelper.defaults.info('Operation cancelled');
  }

  const originalDir = path.join(process.cwd(), 'original');
  const tempDir = path.join(process.cwd(), 'temp');

  await fs.remove(originalDir);
  await fs.remove(tempDir);
}

async function promptUser(
  ioHelper: IoHelper,
  flagName: string,
  currentValue: unknown,
  newValue: boolean,
): Promise<boolean> {
  return ioHelper.requestResponse({
    time: new Date(),
    level: 'info',
    code: 'CDK_TOOLKIT_I9300',
    message: 'Do you want to accept these changes?',
    data: {
      flagName,
      currentValue,
      newValue,
      responseDescription: 'Enter "y" to apply changes or "n" to cancel',
    },
    defaultResponse: false,
  });
}

async function modifyValues(flagName: string, value: string, ioHelper: IoHelper): Promise<void> {
  const cdkJsonPath = path.join(process.cwd(), 'cdk.json');
  const cdkJsonContent = await fs.readFile(cdkJsonPath, 'utf-8');
  const cdkJson = JSON.parse(cdkJsonContent);

  const boolValue = value!.toLowerCase() === 'true';
  cdkJson.context[flagName] = boolValue;

  await ioHelper.defaults.info(`Setting flag '${flagName}' to: ${boolValue}`);
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
