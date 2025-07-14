import type { FeatureFlag } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import type { IoHelper } from '../api-private';

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

export async function displayFlags(flagsData: FeatureFlag[], ioHelper: IoHelper): Promise<void> {
  const headers = ['Feature Flag Name', 'Recommended Value', 'User Value'];

  const rows: string[][] = [];

  flagsData.forEach((flag, index) => {
    if (index === 0 || flagsData[index].module !== flagsData[index - 1].module) {
      rows.push([chalk.bold(`Module: ${flag.module}`), '', '']);
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
