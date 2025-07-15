import type { FeatureFlag } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import type { IoHelper } from '../api-private';
import { FlagsOptions } from '../cli/user-input';

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
    table += formatRow(row) + '\n';
  });

  table += separator;
  return table;
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

  if (all) {
    flagsData.forEach((flag, index) => {
      if (index === 0 || flagsData[index].module !== flagsData[index - 1].module) {
        // ioHelper.defaults.info(chalk.bold(`Module: ${flag.module}`))
        rows.push([chalk.bold(`Module: ${flag.module}`), '','']);
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
}

export async function handleFlags(flagData: FeatureFlag[], ioHelper: IoHelper, options: FlagsOptions) {
  // Handle specific flag name query
  if (options.FLAGNAME && options.FLAGNAME.length > 0 && !options.set) {
    await displayFlags(flagData, ioHelper, options.FLAGNAME[0]);
    return;
  }

  // Handle display all flags
  if (options.all && !options.set) {
    await displayFlags(flagData, ioHelper, undefined, true);
    return;
  }

  // Handle setting flags to recommended values
  if (options.recommended) {
    await setFlagsToRecommended(flagData, ioHelper, options);
    return;
  }

  // Handle setting flags to default values
  if (options.default) {
    await setFlagsToDefault(flagData, ioHelper, options);
    return;
  }

  // Handle setting unconfigured flags
  if (options.unconfigured) {
    await setUnconfiguredFlags(flagData, ioHelper);
    return;
  }

  // Handle setting specific flag value
  if (options.set && options.FLAGNAME && options.FLAGNAME.length > 0) {
    await setSpecificFlag(flagData, ioHelper, options.FLAGNAME[0], options.value);
    return;
  }

  // Default behavior - show all flags if no specific options
  if (!options.FLAGNAME && !options.all && !options.set) {
    await displayFlags(flagData, ioHelper, undefined, true);
  }
}

async function setFlagsToRecommended(flagData: FeatureFlag[], ioHelper: IoHelper, options: FlagsOptions): Promise<void> {
  const flagsToUpdate = options.all ? flagData : flagData.filter(flag => flag.userValue === undefined);
  
  if (flagsToUpdate.length === 0) {
    await ioHelper.defaults.info('No flags to update to recommended values.');
    return;
  }

  await ioHelper.defaults.info(`Setting ${flagsToUpdate.length} flag(s) to recommended values...`);
  
  for (const flag of flagsToUpdate) {
    // actual logic here...
    await ioHelper.defaults.info(`Set ${flag.name} to ${flag.recommendedValue}`);
  }
}

async function setFlagsToDefault(flagData: FeatureFlag[], ioHelper: IoHelper, options: FlagsOptions): Promise<void> {
  const flagsToUpdate = options.all ? flagData : flagData.filter(flag => flag.userValue !== undefined);
  
  if (flagsToUpdate.length === 0) {
    await ioHelper.defaults.info('No flags to reset to default values.');
    return;
  }

  await ioHelper.defaults.info(`Resetting ${flagsToUpdate.length} flag(s) to default values...`);
  
  for (const flag of flagsToUpdate) {
    // Here you would implement the actual flag unsetting logic
    await ioHelper.defaults.info(`Reset ${flag.name} to default`);
  }
}

async function setUnconfiguredFlags(flagData: FeatureFlag[], ioHelper: IoHelper): Promise<void> {
  const unconfiguredFlags = flagData.filter(flag => flag.userValue === undefined);
  
  if (unconfiguredFlags.length === 0) {
    await ioHelper.defaults.info('All flags are already configured.');
    return;
  }

  await ioHelper.defaults.info(`Setting ${unconfiguredFlags.length} unconfigured flag(s) to recommended values...`);
  
  for (const flag of unconfiguredFlags) {
    // logic for setting flags
    await ioHelper.defaults.info(`Set ${flag.name} to ${flag.recommendedValue}`);
  }
}

async function setSpecificFlag(flagData: FeatureFlag[], ioHelper: IoHelper, flagName: string, value?: string): Promise<void> {
  const flag = flagData.find(f => f.name === flagName);
  
  if (!flag) {
    await ioHelper.defaults.info(`Flag '${flagName}' not found.`);
    return;
  }

  if (!value) {
    await ioHelper.defaults.info(`Please specify a value for flag '${flagName}'.`);
    await ioHelper.defaults.info(`Recommended value: ${flag.recommendedValue}`);
    return;
  }
  // actual flag setting logic
  await ioHelper.defaults.info(`Set ${flagName} to ${value}`);
}