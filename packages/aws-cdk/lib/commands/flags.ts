import { formatTable } from '@aws-cdk/cloudformation-diff';
import type { FeatureFlag } from '@aws-cdk/toolkit-lib';
import * as chalk from 'chalk';
import { info } from '../logging';

export async function displayFlags(flagsData: FeatureFlag[]): Promise<void> {
  info('Feature Flags Report:');
  const headers = ['Feature Flag Name', 'Recommended Value', 'User Value'];

  const rows: string[][] = flagsData.flatMap((flag) => {
    const moduleRow: string[] = [chalk.bold(`Module: ${flag.module}`), '', ''];
    const flagRow: string[] = [
      flag.name,
      String(flag.recommendedValue),
      flag.userValue === undefined ? '- <unset>' : String(flag.userValue),
    ];

    return [moduleRow, flagRow];
  });

  const tableData: string[][] = [headers, ...rows];

  const formattedTable = formatTable(tableData, 300);

  info(formattedTable);
}
