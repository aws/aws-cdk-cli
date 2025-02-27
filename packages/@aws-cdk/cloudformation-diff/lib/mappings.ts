import * as chalk from 'chalk';
import { Formatter } from './format';
import { formatTable } from './format-table';

export interface ResourceLocation {
  /**
   * <p>The name associated with the stack.</p>
   * @public
   */
  StackName: string | undefined;
  /**
   * <p>The logical name of the resource specified in the template.</p>
   * @public
   */
  LogicalResourceId: string | undefined;
}

/**
 * <p>Specifies the current source of the resource and the destination of where it will be moved to.</p>
 * @public
 */
export interface ResourceMapping {
  /**
   * <p>The source stack <code>StackName</code> and <code>LogicalResourceId</code> for the resource being
   * refactored.</p>
   * @public
   */
  Source: ResourceLocation | undefined;
  /**
   * <p>The destination stack <code>StackName</code> and <code>LogicalResourceId</code> for the resource being
   * refactored.</p>
   * @public
   */
  Destination: ResourceLocation | undefined;
}

export interface TypedMapping extends ResourceMapping {
  // Type of the mapped resource
  readonly type: string;
}

export function formatTypedMappings(stream: NodeJS.WritableStream, mappings: TypedMapping[]) {
  const header = [['Resource Type', 'Old Logical ID', 'New Logical ID']];
  const rows = mappings.map((m) => [
    m.type,
    `${m.Source?.StackName}.${m.Source?.LogicalResourceId}`,
    `${m.Destination?.StackName}.${m.Destination?.LogicalResourceId}`,
  ]);

  const formatter = new Formatter(stream, {});
  if (mappings.length > 0) {
    formatter.printSectionHeader('The following resources were moved or renamed:');
    formatter.print(chalk.green(formatTable(header.concat(rows), undefined)));
  } else {
    formatter.print('Nothing to refactor.');
  }
}

export function formatAmbiguousMappings(
  stream: NodeJS.WritableStream,
  pairs: [ResourceLocation[], ResourceLocation[]][],
) {
  const tables = pairs.map(renderTable);
  const formatter = new Formatter(stream, {});

  formatter.printSectionHeader('Ambiguous Resource Name Changes');
  formatter.print(tables.join('\n\n'));
  formatter.warning(
    'If you want to take advantage of automatic resource refactoring, avoid\n' +
      'renaming or moving multiple identical resources at the same time.',
  );
  formatter.printSectionFooter();

  function renderTable([removed, added]: [ResourceLocation[], ResourceLocation[]]) {
    return formatTable([['', 'Resource'], renderRemoval(removed), renderAddition(added)], undefined);
  }

  function renderRemoval(locations: ResourceLocation[]) {
    return [chalk.red('-'), chalk.red(renderLocations(locations))];
  }

  function renderAddition(locations: ResourceLocation[]) {
    return [chalk.green('+'), chalk.green(renderLocations(locations))];
  }

  function renderLocations(locs: ResourceLocation[]) {
    return locs.map(renderLocation).join('\n');
  }

  function renderLocation(loc: ResourceLocation) {
    return `${loc.StackName}.${loc.LogicalResourceId}`;
  }
}
