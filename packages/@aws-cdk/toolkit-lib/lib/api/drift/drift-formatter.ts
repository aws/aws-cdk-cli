import { format } from 'node:util';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import { Difference } from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import type { StackResourceDrift } from '@aws-sdk/client-cloudformation';
import { StackResourceDriftStatus } from '@aws-sdk/client-cloudformation';
import * as chalk from 'chalk';
import type { FormattedDrift } from '../../actions/drift';

/**
 * Props for the Drift Formatter
 */
export interface DriftFormatterProps {
  /**
   * The CloudFormation stack artifact
   */
  readonly stack: cxapi.CloudFormationStackArtifact;

  /**
   * The results of stack drift detection
   */
  readonly resourceDrifts: StackResourceDrift[];
}

interface DriftFormatterOutput {
  /**
   * Number of resources with drift. If undefined, then an error occurred
   * and resources were not properly checked for drift.
   */
  readonly numResourcesWithDrift: number;

  /**
   * How many resources were not checked for drift. If undefined, then an
   * error occurred and resources were not properly checked for drift.
   */
  readonly numResourcesUnchecked: number;

  /**
   * Resources that have not changed
   */
  readonly unchanged?: string;

  /**
   * Resources that were not checked for drift or have an UNKNOWN drift status
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

  /**
   * The header, containing the stack name
   */
  readonly stackHeader: string;

  /**
   * The final results (summary) of the drift results
   */
  readonly summary: string;
}

/**
 * Class for formatting drift detection output
 */
export class DriftFormatter {
  public readonly stackName: string;

  private readonly stack: cxapi.CloudFormationStackArtifact;
  private readonly resourceDriftResults: StackResourceDrift[];
  private readonly allStackResources: Map<string, string>;

  constructor(props: DriftFormatterProps) {
    this.stack = props.stack;
    this.stackName = props.stack.displayName ?? props.stack.stackName;
    this.resourceDriftResults = props.resourceDrifts;

    this.allStackResources = new Map<string, string>();
    Object.keys(this.stack.template.Resources || {}).forEach(id => {
      const resource = this.stack.template.Resources[id];
      // always ignore the metadata resource
      if (resource.Type === 'AWS::CDK::Metadata') {
        return;
      }
      this.allStackResources.set(id, resource.Type);
    });
  }

  /**
   * Format the stack drift detection results
   */
  public formatStackDrift(): DriftFormatterOutput {
    const formatterOutput = this.formatStackDriftChanges(this.buildLogicalToPathMap());

    // we are only interested in actual drifts (and ignore the metadata resource)
    const actualDrifts = this.resourceDriftResults.filter(d =>
      d.StackResourceDriftStatus === 'MODIFIED' || d.StackResourceDriftStatus === 'DELETED');

    // must output the stack name if there are drifts
    const stackHeader = format(`Stack ${chalk.bold(this.stackName)}\n`);

    if (actualDrifts.length === 0) {
      const finalResult = chalk.green('No drift detected\n');
      return {
        numResourcesWithDrift: 0,
        numResourcesUnchecked: this.allStackResources.size - this.resourceDriftResults.length,
        stackHeader,
        unchecked: formatterOutput.unchecked,
        summary: finalResult,
      };
    }

    const finalResult = chalk.yellow(`\n${actualDrifts.length} resource${actualDrifts.length === 1 ? '' : 's'} ${actualDrifts.length === 1 ? 'has' : 'have'} drifted from their expected configuration\n`);
    return {
      numResourcesWithDrift: actualDrifts.length,
      numResourcesUnchecked: this.allStackResources.size - this.resourceDriftResults.length,
      stackHeader,
      unchanged: formatterOutput.unchanged,
      unchecked: formatterOutput.unchecked,
      modified: formatterOutput.modified,
      deleted: formatterOutput.deleted,
      summary: finalResult,
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
   * @param driftResults - The stack resource drifts from CloudFormation
   * @param allStackResources - A map of all stack resources
   * @param verbose - Whether to output more verbose text (include undrifted resources)
   * @param logicalToPathMap - A map from logical ID to construct path
   */
  private formatStackDriftChanges(
    logicalToPathMap: { [logicalId: string]: string } = {}): FormattedDrift {
    if (this.resourceDriftResults.length === 0) {
      return {};
    }

    let unchanged;
    let unchecked;
    let modified;
    let deleted;

    const drifts = this.resourceDriftResults;

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

    // Process all unchecked and unknown resources
    const uncheckedResources = Array.from(this.allStackResources.keys()).filter((logicalId) => {
      const drift = drifts.find((d) => d.LogicalResourceId === logicalId);
      return !drift || drift.StackResourceDriftStatus === StackResourceDriftStatus.UNKNOWN;
    });
    if (uncheckedResources.length > 0) {
      unchecked = this.printSectionHeader('Unchecked Resources');
      for (const logicalId of uncheckedResources) {
        const resourceType = this.allStackResources.get(logicalId);
        unchecked += `${CONTEXT} ${this.formatValue(resourceType, chalk.cyan)} ${this.formatLogicalId(logicalToPathMap, logicalId)}\n`;
      }
      unchecked += this.printSectionFooter();
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
