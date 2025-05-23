import { format } from 'node:util';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import { Difference } from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import { StackResourceDriftStatus, type DescribeStackResourceDriftsCommandOutput } from '@aws-sdk/client-cloudformation';
import * as chalk from 'chalk';
import type { DriftResult } from '../../actions/drift';
import type { IoHelper } from '../shared-private';

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

interface DriftFormatterOutput {
  /**
   * Resources that have not changed
   */
  readonly unchanged?: string;

  /**
   * Resources that were not checked for drift
   */
  readonly unchecked?: string;

  /**
   * Resources with drift
   */
  readonly modified?: string;

  /**
   * Resources that have been deleted (drift)
   */
  readonly deleted?: string;
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
  public formatStackDrift(): DriftResult {
    let driftCount = 0;

    if (!this.driftResults?.StackResourceDrifts) {
      return { formattedDrift: { finalResult: 'No drift results available' } };
    }

    const formatterOutput = this.formatStackDriftChanges(this.driftResults, this.allStackResources, this.buildLogicalToPathMap());

    const drifts = this.driftResults.StackResourceDrifts.filter(d =>
      d.StackResourceDriftStatus === 'MODIFIED' ||
      d.StackResourceDriftStatus === 'DELETED',
    );

    // must output the stack name if there are drifts
    let stackHeader;
    if (this.stack.stackName) {
      stackHeader = format(`Stack ${chalk.bold(this.stack.stackName)}\n`);
    }

    if (drifts.length === 0) {
      const finalResult = chalk.green('No drift detected\n');
      return {
        numResourcesWithDrift: 0,
        numResourcesUnchecked: this.allStackResources ? this.allStackResources.size - this.driftResults.StackResourceDrifts.length : -1,
        formattedDrift: { stackHeader, finalResult },
      };
    }

    driftCount = drifts.length;
    let finalResult;
    if (drifts.length !== 0) {
      finalResult = chalk.yellow(`\n${driftCount} resource${driftCount === 1 ? '' : 's'} ${driftCount === 1 ? 'has' : 'have'} drifted from their expected configuration\n`);
    } else {
      finalResult = chalk.green('No drift detected\n');
    }

    return {
      formattedDrift: {
        stackHeader,
        finalResult,
        ...formatterOutput,
      },
      numResourcesWithDrift: driftCount,
      numResourcesUnchecked: this.allStackResources ? this.allStackResources.size - this.driftResults.StackResourceDrifts.length : -1,
    };
  }

  private buildLogicalToPathMap() {
    const map: { [id: string]: string } = {};
    for (const md of this.stack.findMetadataByType(cxschema.ArtifactMetadataEntryType.LOGICAL_ID)) {
      map[md.data as string] = md.path;
    }
    return map;
  }

  /**
   * Renders stack drift information to the given stream
   *
   * @param driftResults The stack resource drifts from CloudFormation
   * @param allStackResources A map of all stack resources
   * @param verbose Whether to output more verbose text (include undrifted resources)
   * @param logicalToPathMap A map from logical ID to construct path
   */
  private formatStackDriftChanges(
    driftResults: DescribeStackResourceDriftsCommandOutput,
    allStackResources?: Map<string, string>,
    logicalToPathMap: { [logicalId: string]: string } = {}): DriftFormatterOutput {
    if (!driftResults.StackResourceDrifts || driftResults.StackResourceDrifts.length === 0) {
      return {};
    }

    let unchanged;
    let unchecked;
    let modified;
    let deleted;

    const drifts = driftResults.StackResourceDrifts;

    // Process unchanged resources
    const unchangedResources = drifts.filter(d => d.StackResourceDriftStatus === StackResourceDriftStatus.IN_SYNC);
    if (unchangedResources.length > 0) {
      unchanged = this.printSectionHeader('Resources In Sync');

      for (const drift of unchangedResources) {
        if (!drift.LogicalResourceId || !drift.ResourceType) continue;
        unchanged += `${CONTEXT} ${this.formatValue(drift.ResourceType, chalk.cyan)} ${this.formatLogicalId(logicalToPathMap, drift.LogicalResourceId)}\n`;
      }
      unchanged += this.printSectionFooter();
    }

    // Process all unchecked resources
    if (allStackResources) {
      const uncheckedResources = Array.from(allStackResources.keys()).filter((logicalId) => {
        return !drifts.find((drift) => drift.LogicalResourceId === logicalId);
      });
      if (uncheckedResources.length > 0) {
        unchecked = this.printSectionHeader('Unchecked Resources');
        for (const logicalId of uncheckedResources) {
          const resourceType = allStackResources.get(logicalId);
          unchecked += `${CONTEXT} ${this.formatValue(resourceType, chalk.cyan)} ${this.formatLogicalId(logicalToPathMap, logicalId)}\n`;
        }
        unchecked += this.printSectionFooter();
      }
    }

    // Process modified resources
    const modifiedResources = drifts.filter(d => d.StackResourceDriftStatus === StackResourceDriftStatus.MODIFIED);
    if (modifiedResources.length > 0) {
      modified = this.printSectionHeader('Modified Resources');

      for (const drift of modifiedResources) {
        if (!drift.LogicalResourceId || !drift.ResourceType) continue;
        if (modified === undefined) modified = '';
        modified += `${UPDATE} ${this.formatValue(drift.ResourceType, chalk.cyan)} ${this.formatLogicalId(logicalToPathMap, drift.LogicalResourceId)}\n`;
        if (drift.PropertyDifferences) {
          const propDiffs = drift.PropertyDifferences;
          for (let i = 0; i < propDiffs.length; i++) {
            const diff = propDiffs[i];
            if (!diff.PropertyPath) continue;
            const difference = new Difference(diff.ExpectedValue, diff.ActualValue);
            modified += this.formatTreeDiff(diff.PropertyPath, difference, i === propDiffs.length - 1);
          }
        }
      }
      modified += this.printSectionFooter();
    }

    // Process deleted resources
    const deletedResources = drifts.filter(d => d.StackResourceDriftStatus === StackResourceDriftStatus.DELETED);
    if (deletedResources.length > 0) {
      deleted = this.printSectionHeader('Deleted Resources');
      for (const drift of deletedResources) {
        if (!drift.LogicalResourceId || !drift.ResourceType) continue;
        deleted += `${REMOVAL} ${this.formatValue(drift.ResourceType, chalk.cyan)} ${this.formatLogicalId(logicalToPathMap, drift.LogicalResourceId)}\n`;
      }
      deleted += this.printSectionFooter();
    }

    return { unchanged, unchecked, modified, deleted };
  }

  private formatLogicalId(logicalToPathMap: { [logicalId: string]: string }, logicalId: string): string {
    const path = logicalToPathMap[logicalId];
    if (!path) return logicalId;

    let normalizedPath = path;
    if (normalizedPath.startsWith('/')) {
      normalizedPath = normalizedPath.slice(1);
    }

    let parts = normalizedPath.split('/');
    if (parts.length > 1) {
      parts = parts.slice(1);

      // remove the last component if it's "Resource" or "Default" (if we have more than a single component)
      if (parts.length > 1) {
        const last = parts[parts.length - 1];
        if (last === 'Resource' || last === 'Default') {
          parts = parts.slice(0, parts.length - 1);
        }
      }

      normalizedPath = parts.join('/');
    }

    return `${normalizedPath} ${chalk.gray(logicalId)}`;
  }

  private formatValue(value: any, colorFn: (str: string) => string): string {
    if (value == null) {
      return '';
    }
    if (typeof value === 'string') {
      return colorFn(value);
    }
    return colorFn(JSON.stringify(value));
  }

  private printSectionHeader(title: string): string {
    return `${chalk.underline(chalk.bold(title))}\n`;
  }

  private printSectionFooter(): string {
    return '\n';
  }

  private formatTreeDiff(propertyPath: string, difference: Difference<any>, isLast: boolean): string {
    let result = format(' %s─ %s %s\n', isLast ? '└' : '├',
      difference.isAddition ? ADDITION :
        difference.isRemoval ? REMOVAL :
          UPDATE,
      propertyPath,
    );
    if (difference.isUpdate) {
      result += format('     ├─ %s %s\n', REMOVAL, this.formatValue(difference.oldValue, chalk.red));
      result += format('     └─ %s %s\n', ADDITION, this.formatValue(difference.newValue, chalk.green));
    }
    return result;
  }
}

const ADDITION = chalk.green('[+]');
const CONTEXT = chalk.grey('[ ]');
const UPDATE = chalk.yellow('[~]');
const REMOVAL = chalk.red('[-]');
