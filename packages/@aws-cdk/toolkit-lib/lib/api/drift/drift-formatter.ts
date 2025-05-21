import { format } from 'node:util';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import { formatStackDriftChanges } from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import type { DescribeStackResourceDriftsCommandOutput } from '@aws-sdk/client-cloudformation';
import * as chalk from 'chalk';
import type { DriftResult } from '../../actions/drift';
import type { IoHelper } from '../shared-private';
import { StringWriteStream } from '../streams';

/**
 * Props for the Drift Formatter
 */
export interface DriftFormatterProps {
  /**
   * Helper for IO operations
   */
  readonly ioHelper: IoHelper;

  /**
   * The CloudFormation stack artifact
   */
  readonly stack: cxapi.CloudFormationStackArtifact;

  /**
   * The results of stack drift detection
   */
  readonly driftResults?: DescribeStackResourceDriftsCommandOutput;

  /**
   * List of all stack resources. Used to determine what resources weren't checked
   * for drift.
   */
  readonly allStackResources?: Map<string, string>;
}

/**
 * Properties specific to formatting the stack drift
 */
export interface FormatStackDriftOptions {
  /**
   * Silences 'No drift detected' messages
   *
   * @default false
   */
  readonly quiet?: boolean;

  /**
   * Whether to be verbose
   *
   * @default false
   */
  readonly verbose?: boolean;
}

/**
 * Class for formatting drift detection output
 */
export class DriftFormatter {
  private readonly stack: cxapi.CloudFormationStackArtifact;
  private readonly driftResults?: DescribeStackResourceDriftsCommandOutput;
  private readonly allStackResources?: Map<string, string>;

  constructor(props: DriftFormatterProps) {
    this.stack = props.stack;
    this.driftResults = props.driftResults;
    this.allStackResources = props.allStackResources;
  }

  /**
   * Format the stack drift detection results
   */
  public formatStackDrift(options: FormatStackDriftOptions = {}): DriftResult {
    const stream = new StringWriteStream();

    let driftCount = 0;

    if (!this.driftResults?.StackResourceDrifts) {
      if (!options.quiet) {
        stream.write('No drift results available.');
        stream.end();
      }
      return { formattedDrift: stream.toString() };
    }

    const drifts = this.driftResults.StackResourceDrifts.filter(d =>
      d.StackResourceDriftStatus === 'MODIFIED' ||
      d.StackResourceDriftStatus === 'DELETED',
    );

    // must output the stack name if there are drifts, even if quiet
    if (this.stack.stackName && (!options.quiet || drifts.length !== 0)) {
      stream.write(format(`Stack ${chalk.bold(this.stack.stackName)}\n`));
    }

    if (drifts.length === 0 && !options.verbose) {
      if (!options.quiet) {
        stream.write(chalk.green('No drift detected\n'));
        stream.end();
      }
      return { formattedDrift: stream.toString(), numResourcesWithDrift: 0 };
    }

    driftCount = drifts.length;
    formatStackDriftChanges(stream, this.driftResults, this.allStackResources, options.verbose, this.buildLogicalToPathMap());
    if (drifts.length !== 0) {
      stream.write(chalk.yellow(`\n${driftCount} resource${driftCount === 1 ? '' : 's'} ${driftCount === 1 ? 'has' : 'have'} drifted from their expected configuration\n`));
    } else {
      stream.write(chalk.green('No drift detected\n'));
    }
    stream.end();

    return {
      formattedDrift: stream.toString(),
      numResourcesWithDrift: driftCount,
      numResourcesUnchecked: this.allStackResources ? this.allStackResources.size - this.driftResults.StackResourceDrifts.length : 0,
    };
  }

  private buildLogicalToPathMap() {
    const map: { [id: string]: string } = {};
    for (const md of this.stack.findMetadataByType(cxschema.ArtifactMetadataEntryType.LOGICAL_ID)) {
      map[md.data as string] = md.path;
    }
    return map;
  }
}
