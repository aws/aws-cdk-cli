import { format } from 'node:util';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import { formatStackDriftChanges } from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import type { DescribeStackResourceDriftsCommandOutput } from '@aws-sdk/client-cloudformation';
import * as chalk from 'chalk';
import type { IoHelper } from '../io/private';
import { StringWriteStream } from '../streams';

/**
 * Output of formatStackDrift
 */
export interface FormatStackDriftOutput {
  /**
   * Number of resources with drift
   */
  readonly numResourcesWithDrift?: number;

  /**
   * Complete formatted drift
   */
  readonly formattedDrift: string;
}

/**
 * Props for the Drift Formatter
 */
export interface DriftFormatterProps {
  /**
   * Helper for the IoHost class
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
}

/**
 * Class for formatting drift detection output
 */
export class DriftFormatter {
  private readonly stack: cxapi.CloudFormationStackArtifact;
  private readonly driftResults?: DescribeStackResourceDriftsCommandOutput;

  constructor(props: DriftFormatterProps) {
    this.stack = props.stack;
    this.driftResults = props.driftResults;
  }

  /**
   * Format the stack drift detection results
   */
  public formatStackDrift(options: FormatStackDriftOptions = {}): FormatStackDriftOutput {
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

    if (drifts.length === 0) {
      if (!options.quiet) {
        stream.write(chalk.green('No drift detected\n'));
        stream.end();
      }
      return { formattedDrift: stream.toString(), numResourcesWithDrift: 0 };
    }

    driftCount = drifts.length;
    formatStackDriftChanges(stream, this.driftResults, this.buildLogicalToPathMap());
    stream.write(chalk.yellow(`\n${driftCount} resource${driftCount === 1 ? '' : 's'} ${driftCount === 1 ? 'has' : 'have'} drifted from their expected configuration\n`));
    stream.end();

    return {
      formattedDrift: stream.toString(),
      numResourcesWithDrift: driftCount,
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
