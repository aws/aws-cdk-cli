import type { FeatureFlagReportProperties } from '@aws-cdk/cloud-assembly-schema';
import { info } from '../logging';

export async function displayFlags(flagsData: FeatureFlagReportProperties[]): Promise<void> {
  info('Feature Flags Report:');
  const headers = ['Feature Flag Name', 'Recommended Value', 'User Value'];

  for (const report of flagsData) {
    const flags = Object.entries(report.flags);
    const columnWidths = [
      Math.max(headers[0].length, ...flags.map(([name]) => name.length)),
      Math.max(headers[1].length, ...flags.map(([, flag]) => String(flag.recommendedValue).length)),
      Math.max(headers[2].length, ...flags.map(([, flag]) => String(flag.userValue).length)),
    ];

    const createSeparator = () => {
      return '+' + columnWidths.map(width => '-'.repeat(width + 2)).join('+') + '+';
    };

    const formatRow = (values: string[]) => {
      return '|' + values.map((value, i) => ` ${value.padEnd(columnWidths[i])} `).join('|') + '|';
    };

    const separator = createSeparator();

    info(separator);
    info(formatRow(headers));
    info(separator);
    info(report.module);

    for (const [flagName, flag] of flags) {
      info(formatRow([flagName, String(flag.recommendedValue), String(flag.userValue)]));
    }

    info(separator);
  }
}
