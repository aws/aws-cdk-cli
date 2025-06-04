import * as chalk from 'chalk';
import { Formatter } from './format';
import { formatTable } from './format-table';

export interface TypedMapping {
  readonly type: string;
  readonly sourcePath: string;
  readonly destinationPath: string;
}

export function formatMappingsHeader(stream: NodeJS.WritableStream) {
  const formatter = new Formatter(stream, {});
  formatter.printSectionHeader('The following resources were moved or renamed:\n');
}

export function formatTypedMappings(stream: NodeJS.WritableStream, mappings: TypedMapping[], env: string) {
  const header = [['Resource Type', 'Old Construct Path', 'New Construct Path']];
  const rows = mappings.map((m) => [m.type, m.sourcePath, m.destinationPath]);

  const formatter = new Formatter(stream, {});
  formatter.print(`${env}:`);
  if (mappings.length > 0) {
    formatter.print(chalk.green(formatTable(header.concat(rows), undefined)));
  } else {
    formatter.print('Nothing to refactor.');
  }
  formatter.print(' ');
}

export function formatAmbiguitySectionHeader(stream: NodeJS.WritableStream) {
  const formatter = new Formatter(stream, {});
  formatter.printSectionHeader('Ambiguous Resource Name Changes:\n');
}

export function formatAmbiguousMappings(
  stream: NodeJS.WritableStream,
  pairs: [string[], string[]][],
  env: string,
) {
  const tables = pairs.map(renderTable);
  const formatter = new Formatter(stream, {});

  formatter.print(`${env}:`);
  formatter.print(tables.join('\n\n'));
  formatter.printSectionFooter();

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
