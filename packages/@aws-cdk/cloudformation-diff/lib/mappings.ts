import * as chalk from 'chalk';
import { Formatter } from './format';
import { formatTable } from './format-table';

export interface TypedMapping {
  readonly type: string;
  readonly sourcePath: string;
  readonly destinationPath: string;
}

export function formatEnvironmentSectionHeader(stream: NodeJS.WritableStream, env: string) {
  const formatter = new Formatter(stream, {});
  formatter.printSectionHeader(`${env}\n`);
}

export function formatTypedMappings(stream: NodeJS.WritableStream, mappings: TypedMapping[]) {
  if (mappings.length > 0) {
    const header = [['Resource Type', 'Old Construct Path', 'New Construct Path']];
    const rows = mappings.map((m) => [m.type, m.sourcePath, m.destinationPath]);
    const formatter = new Formatter(stream, {});

    formatter.print('The following resources were moved or renamed:');
    formatter.print(chalk.green(formatTable(header.concat(rows), undefined)));
    formatter.print(' ');
  }
}

export function formatAmbiguousMappings(
  stream: NodeJS.WritableStream,
  pairs: [string[], string[]][],
) {
  const tables = pairs.map(renderTable);
  const formatter = new Formatter(stream, {});

  formatter.print('Detected ambiguities:');
  formatter.print(tables.join('\n\n'));
  formatter.print(' ');

  function renderTable([removed, added]: [string[], string[]]) {
    return formatTable([['', 'Resource'], renderRemoval(removed), renderAddition(added)], undefined);
  }

  function renderRemoval(locations: string[]) {
    return [chalk.red('-'), chalk.red(renderLocations(locations))];
  }

  function renderAddition(locations: string[]) {
    return [chalk.green('+'), chalk.green(renderLocations(locations))];
  }

  function renderLocations(locs: string[]) {
    return locs.join('\n');
  }
}
