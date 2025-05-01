"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiffFormatter = void 0;
const node_util_1 = require("node:util");
const cxschema = require("@aws-cdk/cloud-assembly-schema");
const cloudformation_diff_1 = require("@aws-cdk/cloudformation-diff");
const chalk = require("chalk");
const private_1 = require("../io/private");
const require_approval_1 = require("../require-approval");
const streams_1 = require("../streams");
const toolkit_error_1 = require("../toolkit-error");
/**
 * Class for formatting the diff output
 */
class DiffFormatter {
    ioHelper;
    oldTemplate;
    newTemplate;
    stackName;
    changeSet;
    nestedStacks;
    driftResults;
    isImport;
    /**
     * Stores the TemplateDiffs that get calculated in this DiffFormatter,
     * indexed by the stack name.
     */
    _diffs = {};
    constructor(props) {
        this.ioHelper = props.ioHelper;
        this.oldTemplate = props.templateInfo.oldTemplate;
        this.newTemplate = props.templateInfo.newTemplate;
        this.stackName = props.templateInfo.newTemplate.stackName;
        this.changeSet = props.templateInfo.changeSet;
        this.nestedStacks = props.templateInfo.nestedStacks;
        this.driftResults = props.driftResults;
        this.isImport = props.templateInfo.isImport ?? false;
    }
    get diffs() {
        return this._diffs;
    }
    /**
     * Format the stack diff
     */
    formatStackDiff(options = {}) {
        const ioDefaultHelper = new private_1.IoDefaultMessages(this.ioHelper);
        return this.formatStackDiffHelper(this.oldTemplate, this.stackName, this.nestedStacks, {
            ...options,
            ioDefaultHelper,
        });
    }
    formatStackDiffHelper(oldTemplate, stackName, nestedStackTemplates, options) {
        let diff = (0, cloudformation_diff_1.fullDiff)(oldTemplate, this.newTemplate.template, this.changeSet, this.isImport);
        this._diffs[stackName] = diff;
        // The stack diff is formatted via `Formatter`, which takes in a stream
        // and sends its output directly to that stream. To faciliate use of the
        // global CliIoHost, we create our own stream to capture the output of
        // `Formatter` and return the output as a string for the consumer of
        // `formatStackDiff` to decide what to do with it.
        const stream = new streams_1.StringWriteStream();
        let numStacksWithChanges = 0;
        let formattedDiff = '';
        let filteredChangesCount = 0;
        try {
            // must output the stack name if there are differences, even if quiet
            if (stackName && (!options.quiet || !diff.isEmpty)) {
                stream.write((0, node_util_1.format)(`Stack ${chalk.bold(stackName)}\n`));
            }
            if (!options.quiet && this.isImport) {
                stream.write('Parameters and rules created during migration do not affect resource configuration.\n');
            }
            // detect and filter out mangled characters from the diff
            if (diff.differenceCount && !options.strict) {
                const mangledNewTemplate = JSON.parse((0, cloudformation_diff_1.mangleLikeCloudFormation)(JSON.stringify(this.newTemplate.template)));
                const mangledDiff = (0, cloudformation_diff_1.fullDiff)(this.oldTemplate, mangledNewTemplate, this.changeSet);
                filteredChangesCount = Math.max(0, diff.differenceCount - mangledDiff.differenceCount);
                if (filteredChangesCount > 0) {
                    diff = mangledDiff;
                }
            }
            // filter out 'AWS::CDK::Metadata' resources from the template
            // filter out 'CheckBootstrapVersion' rules from the template
            if (!options.strict) {
                obscureDiff(diff);
            }
            if (!diff.isEmpty) {
                numStacksWithChanges++;
                // formatDifferences updates the stream with the formatted stack diff
                (0, cloudformation_diff_1.formatDifferences)(stream, diff, {
                    ...logicalIdMapFromTemplate(this.oldTemplate),
                    ...buildLogicalToPathMap(this.newTemplate),
                }, options.context);
            }
            else if (!options.quiet) {
                stream.write(chalk.green('There were no differences\n'));
            }
            if (filteredChangesCount > 0) {
                stream.write(chalk.yellow(`Omitted ${filteredChangesCount} changes because they are likely mangled non-ASCII characters. Use --strict to print them.\n`));
            }
        }
        finally {
            // store the stream containing a formatted stack diff
            formattedDiff = stream.toString();
            stream.end();
        }
        for (const nestedStackLogicalId of Object.keys(nestedStackTemplates ?? {})) {
            if (!nestedStackTemplates) {
                break;
            }
            const nestedStack = nestedStackTemplates[nestedStackLogicalId];
            this.newTemplate._template = nestedStack.generatedTemplate;
            const nextDiff = this.formatStackDiffHelper(nestedStack.deployedTemplate, nestedStack.physicalName ?? nestedStackLogicalId, nestedStack.nestedStackTemplates, options);
            numStacksWithChanges += nextDiff.numStacksWithChanges;
            formattedDiff += nextDiff.formattedDiff;
        }
        return {
            numStacksWithChanges,
            formattedDiff,
        };
    }
    /**
     * Format the security diff
     */
    formatSecurityDiff(options) {
        const ioDefaultHelper = new private_1.IoDefaultMessages(this.ioHelper);
        const diff = (0, cloudformation_diff_1.fullDiff)(this.oldTemplate, this.newTemplate.template, this.changeSet);
        this._diffs[this.stackName] = diff;
        if (diffRequiresApproval(diff, options.requireApproval)) {
            // The security diff is formatted via `Formatter`, which takes in a stream
            // and sends its output directly to that stream. To faciliate use of the
            // global CliIoHost, we create our own stream to capture the output of
            // `Formatter` and return the output as a string for the consumer of
            // `formatSecurityDiff` to decide what to do with it.
            const stream = new streams_1.StringWriteStream();
            stream.write((0, node_util_1.format)(`Stack ${chalk.bold(this.stackName)}\n`));
            // eslint-disable-next-line max-len
            ioDefaultHelper.warning(`This deployment will make potentially sensitive changes according to your current security approval level (--require-approval ${options.requireApproval}).`);
            ioDefaultHelper.warning('Please confirm you intend to make the following modifications:\n');
            try {
                // formatSecurityChanges updates the stream with the formatted security diff
                (0, cloudformation_diff_1.formatSecurityChanges)(stream, diff, buildLogicalToPathMap(this.newTemplate));
            }
            finally {
                stream.end();
            }
            // store the stream containing a formatted stack diff
            const formattedDiff = stream.toString();
            return { formattedDiff };
        }
        return {};
    }
    formatStackDrift(options) {
        const stream = new streams_1.StringWriteStream();
        let driftCount = 0;
        if (!this.driftResults?.StackResourceDrifts) {
            return { formattedDrift: '', numResourcesWithDrift: 0 };
        }
        const drifts = this.driftResults.StackResourceDrifts.filter(d => d.StackResourceDriftStatus === 'MODIFIED' ||
            d.StackResourceDriftStatus === 'DELETED');
        if (drifts.length === 0 && !options.quiet) {
            stream.write(chalk.green('No drift detected\n'));
            stream.end();
            return { formattedDrift: stream.toString(), numResourcesWithDrift: 0 };
        }
        driftCount = drifts.length;
        (0, cloudformation_diff_1.formatStackDriftChanges)(stream, this.driftResults, buildLogicalToPathMap(this.newTemplate));
        stream.write(chalk.yellow(`\n${driftCount} resource${driftCount === 1 ? '' : 's'} ${driftCount === 1 ? 'has' : 'have'} drifted from their expected configuration\n`));
        stream.end();
        return {
            formattedDrift: stream.toString(),
            numResourcesWithDrift: driftCount,
        };
    }
}
exports.DiffFormatter = DiffFormatter;
/**
 * Return whether the diff has security-impacting changes that need confirmation
 *
 * TODO: Filter the security impact determination based off of an enum that allows
 * us to pick minimum "severities" to alert on.
 */
function diffRequiresApproval(diff, requireApproval) {
    switch (requireApproval) {
        case require_approval_1.RequireApproval.NEVER: return false;
        case require_approval_1.RequireApproval.ANY_CHANGE: return diff.permissionsAnyChanges;
        case require_approval_1.RequireApproval.BROADENING: return diff.permissionsBroadened;
        default: throw new toolkit_error_1.ToolkitError(`Unrecognized approval level: ${requireApproval}`);
    }
}
function buildLogicalToPathMap(stack) {
    const map = {};
    for (const md of stack.findMetadataByType(cxschema.ArtifactMetadataEntryType.LOGICAL_ID)) {
        map[md.data] = md.path;
    }
    return map;
}
function logicalIdMapFromTemplate(template) {
    const ret = {};
    for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
        const path = resource?.Metadata?.['aws:cdk:path'];
        if (path) {
            ret[logicalId] = path;
        }
    }
    return ret;
}
/**
 * Remove any template elements that we don't want to show users.
 * This is currently:
 * - AWS::CDK::Metadata resource
 * - CheckBootstrapVersion Rule
 */
function obscureDiff(diff) {
    if (diff.unknown) {
        // see https://github.com/aws/aws-cdk/issues/17942
        diff.unknown = diff.unknown.filter(change => {
            if (!change) {
                return true;
            }
            if (change.newValue?.CheckBootstrapVersion) {
                return false;
            }
            if (change.oldValue?.CheckBootstrapVersion) {
                return false;
            }
            return true;
        });
    }
    if (diff.resources) {
        diff.resources = diff.resources.filter(change => {
            if (!change) {
                return true;
            }
            if (change.newResourceType === 'AWS::CDK::Metadata') {
                return false;
            }
            if (change.oldResourceType === 'AWS::CDK::Metadata') {
                return false;
            }
            return true;
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlmZi1mb3JtYXR0ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXBpL2RpZmYvZGlmZi1mb3JtYXR0ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEseUNBQW1DO0FBQ25DLDJEQUEyRDtBQUMzRCxzRUFPc0M7QUFHdEMsK0JBQStCO0FBRy9CLDJDQUFrRDtBQUNsRCwwREFBc0Q7QUFDdEQsd0NBQStDO0FBQy9DLG9EQUFnRDtBQXlKaEQ7O0dBRUc7QUFDSCxNQUFhLGFBQWE7SUFDUCxRQUFRLENBQVc7SUFDbkIsV0FBVyxDQUFNO0lBQ2pCLFdBQVcsQ0FBb0M7SUFDL0MsU0FBUyxDQUFTO0lBQ2xCLFNBQVMsQ0FBTztJQUNoQixZQUFZLENBQXVFO0lBQ25GLFlBQVksQ0FBNEM7SUFDeEQsUUFBUSxDQUFVO0lBRW5DOzs7T0FHRztJQUNLLE1BQU0sR0FBcUMsRUFBRSxDQUFDO0lBRXRELFlBQVksS0FBeUI7UUFDbkMsSUFBSSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDO1FBQy9CLElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSyxDQUFDLFlBQVksQ0FBQyxXQUFXLENBQUM7UUFDbEQsSUFBSSxDQUFDLFdBQVcsR0FBRyxLQUFLLENBQUMsWUFBWSxDQUFDLFdBQVcsQ0FBQztRQUNsRCxJQUFJLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQyxZQUFZLENBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQztRQUMxRCxJQUFJLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDO1FBQzlDLElBQUksQ0FBQyxZQUFZLEdBQUcsS0FBSyxDQUFDLFlBQVksQ0FBQyxZQUFZLENBQUM7UUFDcEQsSUFBSSxDQUFDLFlBQVksR0FBRyxLQUFLLENBQUMsWUFBWSxDQUFDO1FBQ3ZDLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFlBQVksQ0FBQyxRQUFRLElBQUksS0FBSyxDQUFD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Q0FBQztRQUNuQixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFO1lBQzlDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDWixPQUFPLElBQUksQ0FBQztZQUNkLENBQUM7WUFDRCxJQUFJLE1BQU0sQ0FBQyxlQUFlLEtBQUssb0JBQW9CLEVBQUUsQ0FBQztnQkFDcEQsT0FBTyxLQUFLLENBQUM7WUFDZixDQUFDO1lBQ0QsSUFBSSxNQUFNLENBQUMsZUFBZSxLQUFLLG9CQUFvQixFQUFFLENBQUM7Z0JBQ3BELE9BQU8sS0FBSyxDQUFDO1lBQ2YsQ0FBQztZQUNELE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGZvcm1hdCB9IGZyb20gJ25vZGU6dXRpbCc7XG5pbXBvcnQgKiBhcyBjeHNjaGVtYSBmcm9tICdAYXdzLWNkay9jbG91ZC1hc3NlbWJseS1zY2hlbWEnO1xuaW1wb3J0IHtcbiAgZm9ybWF0RGlmZmVyZW5jZXMsXG4gIGZvcm1hdFNlY3VyaXR5Q2hhbmdlcyxcbiAgZnVsbERpZmYsXG4gIG1hbmdsZUxpa2VDbG91ZEZvcm1hdGlvbixcbiAgdHlwZSBUZW1wbGF0ZURpZmYsXG4gIGZvcm1hdFN0YWNrRHJpZnRDaGFuZ2VzLFxufSBmcm9tICdAYXdzLWNkay9jbG91ZGZvcm1hdGlvbi1kaWZmJztcbmltcG9ydCB0eXBlICogYXMgY3hhcGkgZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB0eXBlIHsgRGVzY3JpYmVTdGFja1Jlc291cmNlRHJpZnRzQ29tbWFuZE91dHB1dCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1jbG91ZGZvcm1hdGlvbic7XG5pbXBvcnQgKiBhcyBjaGFsayBmcm9tICdjaGFsayc7XG5pbXBvcnQgdHlwZSB7IE5lc3RlZFN0YWNrVGVtcGxhdGVzIH0gZnJvbSAnLi4vY2xvdWRmb3JtYXRpb24nO1xuaW1wb3J0IHR5cGUgeyBJb0hlbHBlciB9IGZyb20gJy4uL2lvL3ByaXZhdGUnO1xuaW1wb3J0IHsgSW9EZWZhdWx0TWVzc2FnZXMgfSBmcm9tICcuLi9pby9wcml2YXRlJztcbmltcG9ydCB7IFJlcXVpcmVBcHByb3ZhbCB9IGZyb20gJy4uL3JlcXVpcmUtYXBwcm92YWwnO1xuaW1wb3J0IHsgU3RyaW5nV3JpdGVTdHJlYW0gfSBmcm9tICcuLi9zdHJlYW1zJztcbmltcG9ydCB7IFRvb2xraXRFcnJvciB9IGZyb20gJy4uL3Rvb2xraXQtZXJyb3InO1xuXG4vKipcbiAqIE91dHB1dCBvZiBmb3JtYXRTZWN1cml0eURpZmZcbiAqL1xuaW50ZXJmYWNlIEZvcm1hdFNlY3VyaXR5RGlmZk91dHB1dCB7XG4gIC8qKlxuICAgKiBDb21wbGV0ZSBmb3JtYXR0ZWQgc2VjdXJpdHkgZGlmZiwgaWYgaXQgaXMgcHJvbXB0LXdvcnRoeVxuICAgKi9cbiAgcmVhZG9ubHkgZm9ybWF0dGVkRGlmZj86IHN0cmluZztcbn1cblxuLyoqXG4gKiBPdXRwdXQgb2YgZm9ybWF0U3RhY2tEaWZmXG4gKi9cbmludGVyZmFjZSBGb3JtYXRTdGFja0RpZmZPdXRwdXQge1xuICAvKipcbiAgICogTnVtYmVyIG9mIHN0YWNrcyB3aXRoIGRpZmYgY2hhbmdlc1xuICAgKi9cbiAgcmVhZG9ubHkgbnVtU3RhY2tzV2l0aENoYW5nZXM6IG51bWJlcjtcblxuICAvKipcbiAgICogQ29tcGxldGUgZm9ybWF0dGVkIGRpZmZcbiAgICovXG4gIHJlYWRvbmx5IGZvcm1hdHRlZERpZmY6IHN0cmluZztcbn1cblxuLyoqXG4gKiBPdXRwdXQgb2YgZm9ybWF0U3RhY2tEcmlmdFxuICovXG5pbnRlcmZhY2UgRm9ybWF0U3RhY2tEcmlmdE91dHB1dCB7XG4gIC8qKlxuICAgKiBOdW1iZXIgb2Ygc3RhY2tzIHdpdGggZHJpZnRcbiAgICovXG4gIHJlYWRvbmx5IG51bVJlc291cmNlc1dpdGhEcmlmdDogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBDb21wbGV0ZSBmb3JtYXR0ZWQgZHJpZnRcbiAgICovXG4gIHJlYWRvbmx5IGZvcm1hdHRlZERyaWZ0OiBzdHJpbmc7XG59XG5cbi8qKlxuICogUHJvcHMgZm9yIHRoZSBEaWZmIEZvcm1hdHRlclxuICovXG5pbnRlcmZhY2UgRGlmZkZvcm1hdHRlclByb3BzIHtcbiAgLyoqXG4gICAqIEhlbHBlciBmb3IgdGhlIElvSG9zdCBjbGFzc1xuICAgKi9cbiAgcmVhZG9ubHkgaW9IZWxwZXI6IElvSGVscGVyO1xuXG4gIC8qKlxuICAgKiBUaGUgcmVsZXZhbnQgaW5mb3JtYXRpb24gZm9yIHRoZSBUZW1wbGF0ZSB0aGF0IGlzIGJlaW5nIGRpZmZlZC5cbiAgICogSW5jbHVkZXMgdGhlIG9sZC9jdXJyZW50IHN0YXRlIG9mIHRoZSBzdGFjayBhcyB3ZWxsIGFzIHRoZSBuZXcgc3RhdGUuXG4gICAqL1xuICByZWFkb25seSB0ZW1wbGF0ZUluZm86IFRlbXBsYXRlSW5mbztcblxuICAvKipcbiAgICogVGhlIHJlc3VsdHMgb2Ygc3RhY2sgZHJpZnRcbiAgICovXG4gIHJlYWRvbmx5IGRyaWZ0UmVzdWx0cz86IERlc2NyaWJlU3RhY2tSZXNvdXJjZURyaWZ0c0NvbW1hbmRPdXRwdXQ7XG59XG5cbi8qKlxuICogUHJvcGVydGllcyBzcGVjaWZpYyB0byBmb3JtYXR0aW5nIHRoZSBzZWN1cml0eSBkaWZmXG4gKi9cbmludGVyZmFjZSBGb3JtYXRTZWN1cml0eURpZmZPcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSBhcHByb3ZhbCBsZXZlbCBvZiB0aGUgc2VjdXJpdHkgZGlmZlxuICAgKi9cbiAgcmVhZG9ubHkgcmVxdWlyZUFwcHJvdmFsOiBSZXF1aXJlQXBwcm92YWw7XG59XG5cbi8qKlxuICogUHJvcGVydGllcyBzcGVjaWZpYyB0byBmb3JtYXR0aW5nIHRoZSBzdGFjayBkaWZmXG4gKi9cbmludGVyZmFjZSBGb3JtYXRTdGFja0RpZmZPcHRpb25zIHtcbiAgLyoqXG4gICAqIGRvIG5vdCBmaWx0ZXIgb3V0IEFXUzo6Q0RLOjpNZXRhZGF0YSBvciBSdWxlc1xuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgc3RyaWN0PzogYm9vbGVhbjtcblxuICAvKipcbiAgICogbGluZXMgb2YgY29udGV4dCB0byB1c2UgaW4gYXJiaXRyYXJ5IEpTT04gZGlmZlxuICAgKlxuICAgKiBAZGVmYXVsdCAzXG4gICAqL1xuICByZWFkb25seSBjb250ZXh0PzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBzaWxlbmNlcyBcXCdUaGVyZSB3ZXJlIG5vIGRpZmZlcmVuY2VzXFwnIG1lc3NhZ2VzXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBxdWlldD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogUHJvcGVydGllcyBzcGVjaWZpYyB0byBmb3JtYXR0aW5nIHRoZSBzdGFjayBkcmlmdCBkaWZmXG4gKi9cbmludGVyZmFjZSBGb3JtYXRTdGFja0RyaWZ0T3B0aW9ucyB7XG4gIC8qKlxuICAgKiBTaWxlbmNlcyAnVGhlcmUgd2VyZSBubyBkaWZmZXJlbmNlcycgbWVzc2FnZXNcbiAgICovXG4gIHJlYWRvbmx5IHF1aWV0PzogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIFJldXNhYmxlU3RhY2tEaWZmT3B0aW9ucyBleHRlbmRzIEZvcm1hdFN0YWNrRGlmZk9wdGlvbnMge1xuICByZWFkb25seSBpb0RlZmF1bHRIZWxwZXI6IElvRGVmYXVsdE1lc3NhZ2VzO1xufVxuXG4vKipcbiAqIEluZm9ybWF0aW9uIG9uIGEgdGVtcGxhdGUncyBvbGQvbmV3IHN0YXRlXG4gKiB0aGF0IGlzIHVzZWQgZm9yIGRpZmYuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVGVtcGxhdGVJbmZvIHtcbiAgLyoqXG4gICAqIFRoZSBvbGQvZXhpc3RpbmcgdGVtcGxhdGVcbiAgICovXG4gIHJlYWRvbmx5IG9sZFRlbXBsYXRlOiBhbnk7XG5cbiAgLyoqXG4gICAqIFRoZSBuZXcgdGVtcGxhdGVcbiAgICovXG4gIHJlYWRvbmx5IG5ld1RlbXBsYXRlOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3Q7XG5cbiAgLyoqXG4gICAqIEEgQ2xvdWRGb3JtYXRpb24gQ2hhbmdlU2V0IHRvIGhlbHAgdGhlIGRpZmYgb3BlcmF0aW9uLlxuICAgKiBQcm9iYWJseSBjcmVhdGVkIHZpYSBgY3JlYXRlRGlmZkNoYW5nZVNldGAuXG4gICAqXG4gICAqIEBkZWZhdWx0IHVuZGVmaW5lZFxuICAgKi9cbiAgcmVhZG9ubHkgY2hhbmdlU2V0PzogYW55O1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIG9yIG5vdCB0aGVyZSBhcmUgYW55IGltcG9ydGVkIHJlc291cmNlc1xuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgaXNJbXBvcnQ/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBBbnkgbmVzdGVkIHN0YWNrcyBpbmNsdWRlZCBpbiB0aGUgdGVtcGxhdGVcbiAgICpcbiAgICogQGRlZmF1bHQge31cbiAgICovXG4gIHJlYWRvbmx5IG5lc3RlZFN0YWNrcz86IHtcbiAgICBbbmVzdGVkU3RhY2tMb2dpY2FsSWQ6IHN0cmluZ106IE5lc3RlZFN0YWNrVGVtcGxhdGVzO1xuICB9O1xufVxuXG4vKipcbiAqIENsYXNzIGZvciBmb3JtYXR0aW5nIHRoZSBkaWZmIG91dHB1dFxuICovXG5leHBvcnQgY2xhc3MgRGlmZkZvcm1hdHRlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgaW9IZWxwZXI6IElvSGVscGVyO1xuICBwcml2YXRlIHJlYWRvbmx5IG9sZFRlbXBsYXRlOiBhbnk7XG4gIHByaXZhdGUgcmVhZG9ubHkgbmV3VGVtcGxhdGU6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdDtcbiAgcHJpdmF0ZSByZWFkb25seSBzdGFja05hbWU6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBjaGFuZ2VTZXQ/OiBhbnk7XG4gIHByaXZhdGUgcmVhZG9ubHkgbmVzdGVkU3RhY2tzOiB7IFtuZXN0ZWRTdGFja0xvZ2ljYWxJZDogc3RyaW5nXTogTmVzdGVkU3RhY2tUZW1wbGF0ZXMgfSB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSByZWFkb25seSBkcmlmdFJlc3VsdHM/OiBEZXNjcmliZVN0YWNrUmVzb3VyY2VEcmlmdHNDb21tYW5kT3V0cHV0O1xuICBwcml2YXRlIHJlYWRvbmx5IGlzSW1wb3J0OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBTdG9yZXMgdGhlIFRlbXBsYXRlRGlmZnMgdGhhdCBnZXQgY2FsY3VsYXRlZCBpbiB0aGlzIERpZmZGb3JtYXR0ZXIsXG4gICAqIGluZGV4ZWQgYnkgdGhlIHN0YWNrIG5hbWUuXG4gICAqL1xuICBwcml2YXRlIF9kaWZmczogeyBbbmFtZTogc3RyaW5nXTogVGVtcGxhdGVEaWZmIH0gPSB7fTtcblxuICBjb25zdHJ1Y3Rvcihwcm9wczogRGlmZkZvcm1hdHRlclByb3BzKSB7XG4gICAgdGhpcy5pb0hlbHBlciA9IHByb3BzLmlvSGVscGVyO1xuICAgIHRoaXMub2xkVGVtcGxhdGUgPSBwcm9wcy50ZW1wbGF0ZUluZm8ub2xkVGVtcGxhdGU7XG4gICAgdGhpcy5uZXdUZW1wbGF0ZSA9IHByb3BzLnRlbXBsYXRlSW5mby5uZXdUZW1wbGF0ZTtcbiAgICB0aGlzLnN0YWNrTmFtZSA9IHByb3BzLnRlbXBsYXRlSW5mby5uZXdUZW1wbGF0ZS5zdGFja05hbWU7XG4gICAgdGhpcy5jaGFuZ2VTZXQgPSBwcm9wcy50ZW1wbGF0ZUluZm8uY2hhbmdlU2V0O1xuICAgIHRoaXMubmVzdGVkU3RhY2tzID0gcHJvcHMudGVtcGxhdGVJbmZvLm5lc3RlZFN0YWNrcztcbiAgICB0aGlzLmRyaWZ0UmVzdWx0cyA9IHByb3BzLmRyaWZ0UmVzdWx0cztcbiAgICB0aGlzLmlzSW1wb3J0ID0gcHJvcHMudGVtcGxhdGVJbmZvLmlzSW1wb3J0ID8/IGZhbHNlO1xuICB9XG5cbiAgcHVibGljIGdldCBkaWZmcygpIHtcbiAgICByZXR1cm4gdGhpcy5fZGlmZnM7XG4gIH1cblxuICAvKipcbiAgICogRm9ybWF0IHRoZSBzdGFjayBkaWZmXG4gICAqL1xuICBwdWJsaWMgZm9ybWF0U3RhY2tEaWZmKG9wdGlvbnM6IEZvcm1hdFN0YWNrRGlmZk9wdGlvbnMgPSB7fSk6IEZvcm1hdFN0YWNrRGlmZk91dHB1dCB7XG4gICAgY29uc3QgaW9EZWZhdWx0SGVscGVyID0gbmV3IElvRGVmYXVsdE1lc3NhZ2VzKHRoaXMuaW9IZWxwZXIpO1xuICAgIHJldHVybiB0aGlzLmZvcm1hdFN0YWNrRGlmZkhlbHBlcihcbiAgICAgIHRoaXMub2xkVGVtcGxhdGUsXG4gICAgICB0aGlzLnN0YWNrTmFtZSxcbiAgICAgIHRoaXMubmVzdGVkU3RhY2tzLFxuICAgICAge1xuICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICBpb0RlZmF1bHRIZWxwZXIsXG4gICAgICB9LFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGZvcm1hdFN0YWNrRGlmZkhlbHBlcihcbiAgICBvbGRUZW1wbGF0ZTogYW55LFxuICAgIHN0YWNrTmFtZTogc3RyaW5nLFxuICAgIG5lc3RlZFN0YWNrVGVtcGxhdGVzOiB7IFtuZXN0ZWRTdGFja0xvZ2ljYWxJZDogc3RyaW5nXTogTmVzdGVkU3RhY2tUZW1wbGF0ZXMgfSB8IHVuZGVmaW5lZCxcbiAgICBvcHRpb25zOiBSZXVzYWJsZVN0YWNrRGlmZk9wdGlvbnMsXG4gICkge1xuICAgIGxldCBkaWZmID0gZnVsbERpZmYob2xkVGVtcGxhdGUsIHRoaXMubmV3VGVtcGxhdGUudGVtcGxhdGUsIHRoaXMuY2hhbmdlU2V0LCB0aGlzLmlzSW1wb3J0KTtcbiAgICB0aGlzLl9kaWZmc1tzdGFja05hbWVdID0gZGlmZjtcblxuICAgIC8vIFRoZSBzdGFjayBkaWZmIGlzIGZvcm1hdHRlZCB2aWEgYEZvcm1hdHRlcmAsIHdoaWNoIHRha2VzIGluIGEgc3RyZWFtXG4gICAgLy8gYW5kIHNlbmRzIGl0cyBvdXRwdXQgZGlyZWN0bHkgdG8gdGhhdCBzdHJlYW0uIFRvIGZhY2lsaWF0ZSB1c2Ugb2YgdGhlXG4gICAgLy8gZ2xvYmFsIENsaUlvSG9zdCwgd2UgY3JlYXRlIG91ciBvd24gc3RyZWFtIHRvIGNhcHR1cmUgdGhlIG91dHB1dCBvZlxuICAgIC8vIGBGb3JtYXR0ZXJgIGFuZCByZXR1cm4gdGhlIG91dHB1dCBhcyBhIHN0cmluZyBmb3IgdGhlIGNvbnN1bWVyIG9mXG4gICAgLy8gYGZvcm1hdFN0YWNrRGlmZmAgdG8gZGVjaWRlIHdoYXQgdG8gZG8gd2l0aCBpdC5cbiAgICBjb25zdCBzdHJlYW0gPSBuZXcgU3RyaW5nV3JpdGVTdHJlYW0oKTtcblxuICAgIGxldCBudW1TdGFja3NXaXRoQ2hhbmdlcyA9IDA7XG4gICAgbGV0IGZvcm1hdHRlZERpZmYgPSAnJztcbiAgICBsZXQgZmlsdGVyZWRDaGFuZ2VzQ291bnQgPSAwO1xuICAgIHRyeSB7XG4gICAgICAvLyBtdXN0IG91dHB1dCB0aGUgc3RhY2sgbmFtZSBpZiB0aGVyZSBhcmUgZGlmZmVyZW5jZXMsIGV2ZW4gaWYgcXVpZXRcbiAgICAgIGlmIChzdGFja05hbWUgJiYgKCFvcHRpb25zLnF1aWV0IHx8ICFkaWZmLmlzRW1wdHkpKSB7XG4gICAgICAgIHN0cmVhbS53cml0ZShmb3JtYXQoYFN0YWNrICR7Y2hhbGsuYm9sZChzdGFja05hbWUpfVxcbmApKTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFvcHRpb25zLnF1aWV0ICYmIHRoaXMuaXNJbXBvcnQpIHtcbiAgICAgICAgc3RyZWFtLndyaXRlKCdQYXJhbWV0ZXJzIGFuZCBydWxlcyBjcmVhdGVkIGR1cmluZyBtaWdyYXRpb24gZG8gbm90IGFmZmVjdCByZXNvdXJjZSBjb25maWd1cmF0aW9uLlxcbicpO1xuICAgICAgfVxuXG4gICAgICAvLyBkZXRlY3QgYW5kIGZpbHRlciBvdXQgbWFuZ2xlZCBjaGFyYWN0ZXJzIGZyb20gdGhlIGRpZmZcbiAgICAgIGlmIChkaWZmLmRpZmZlcmVuY2VDb3VudCAmJiAhb3B0aW9ucy5zdHJpY3QpIHtcbiAgICAgICAgY29uc3QgbWFuZ2xlZE5ld1RlbXBsYXRlID0gSlNPTi5wYXJzZShtYW5nbGVMaWtlQ2xvdWRGb3JtYXRpb24oSlNPTi5zdHJpbmdpZnkodGhpcy5uZXdUZW1wbGF0ZS50ZW1wbGF0ZSkpKTtcbiAgICAgICAgY29uc3QgbWFuZ2xlZERpZmYgPSBmdWxsRGlmZih0aGlzLm9sZFRlbXBsYXRlLCBtYW5nbGVkTmV3VGVtcGxhdGUsIHRoaXMuY2hhbmdlU2V0KTtcbiAgICAgICAgZmlsdGVyZWRDaGFuZ2VzQ291bnQgPSBNYXRoLm1heCgwLCBkaWZmLmRpZmZlcmVuY2VDb3VudCAtIG1hbmdsZWREaWZmLmRpZmZlcmVuY2VDb3VudCk7XG4gICAgICAgIGlmIChmaWx0ZXJlZENoYW5nZXNDb3VudCA+IDApIHtcbiAgICAgICAgICBkaWZmID0gbWFuZ2xlZERpZmY7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gZmlsdGVyIG91dCAnQVdTOjpDREs6Ok1ldGFkYXRhJyByZXNvdXJjZXMgZnJvbSB0aGUgdGVtcGxhdGVcbiAgICAgIC8vIGZpbHRlciBvdXQgJ0NoZWNrQm9vdHN0cmFwVmVyc2lvbicgcnVsZXMgZnJvbSB0aGUgdGVtcGxhdGVcbiAgICAgIGlmICghb3B0aW9ucy5zdHJpY3QpIHtcbiAgICAgICAgb2JzY3VyZURpZmYoZGlmZik7XG4gICAgICB9XG5cbiAgICAgIGlmICghZGlmZi5pc0VtcHR5KSB7XG4gICAgICAgIG51bVN0YWNrc1dpdGhDaGFuZ2VzKys7XG5cbiAgICAgICAgLy8gZm9ybWF0RGlmZmVyZW5jZXMgdXBkYXRlcyB0aGUgc3RyZWFtIHdpdGggdGhlIGZvcm1hdHRlZCBzdGFjayBkaWZmXG4gICAgICAgIGZvcm1hdERpZmZlcmVuY2VzKHN0cmVhbSwgZGlmZiwge1xuICAgICAgICAgIC4uLmxvZ2ljYWxJZE1hcEZyb21UZW1wbGF0ZSh0aGlzLm9sZFRlbXBsYXRlKSxcbiAgICAgICAgICAuLi5idWlsZExvZ2ljYWxUb1BhdGhNYXAodGhpcy5uZXdUZW1wbGF0ZSksXG4gICAgICAgIH0sIG9wdGlvbnMuY29udGV4dCk7XG4gICAgICB9IGVsc2UgaWYgKCFvcHRpb25zLnF1aWV0KSB7XG4gICAgICAgIHN0cmVhbS53cml0ZShjaGFsay5ncmVlbignVGhlcmUgd2VyZSBubyBkaWZmZXJlbmNlc1xcbicpKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGZpbHRlcmVkQ2hhbmdlc0NvdW50ID4gMCkge1xuICAgICAgICBzdHJlYW0ud3JpdGUoY2hhbGsueWVsbG93KGBPbWl0dGVkICR7ZmlsdGVyZWRDaGFuZ2VzQ291bnR9IGNoYW5nZXMgYmVjYXVzZSB0aGV5IGFyZSBsaWtlbHkgbWFuZ2xlZCBub24tQVNDSUkgY2hhcmFjdGVycy4gVXNlIC0tc3RyaWN0IHRvIHByaW50IHRoZW0uXFxuYCkpO1xuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICAvLyBzdG9yZSB0aGUgc3RyZWFtIGNvbnRhaW5pbmcgYSBmb3JtYXR0ZWQgc3RhY2sgZGlmZlxuICAgICAgZm9ybWF0dGVkRGlmZiA9IHN0cmVhbS50b1N0cmluZygpO1xuICAgICAgc3RyZWFtLmVuZCgpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgbmVzdGVkU3RhY2tMb2dpY2FsSWQgb2YgT2JqZWN0LmtleXMobmVzdGVkU3RhY2tUZW1wbGF0ZXMgPz8ge30pKSB7XG4gICAgICBpZiAoIW5lc3RlZFN0YWNrVGVtcGxhdGVzKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY29uc3QgbmVzdGVkU3RhY2sgPSBuZXN0ZWRTdGFja1RlbXBsYXRlc1tuZXN0ZWRTdGFja0xvZ2ljYWxJZF07XG5cbiAgICAgICh0aGlzLm5ld1RlbXBsYXRlIGFzIGFueSkuX3RlbXBsYXRlID0gbmVzdGVkU3RhY2suZ2VuZXJhdGVkVGVtcGxhdGU7XG4gICAgICBjb25zdCBuZXh0RGlmZiA9IHRoaXMuZm9ybWF0U3RhY2tEaWZmSGVscGVyKFxuICAgICAgICBuZXN0ZWRTdGFjay5kZXBsb3llZFRlbXBsYXRlLFxuICAgICAgICBuZXN0ZWRTdGFjay5waHlzaWNhbE5hbWUgPz8gbmVzdGVkU3RhY2tMb2dpY2FsSWQsXG4gICAgICAgIG5lc3RlZFN0YWNrLm5lc3RlZFN0YWNrVGVtcGxhdGVzLFxuICAgICAgICBvcHRpb25zLFxuICAgICAgKTtcbiAgICAgIG51bVN0YWNrc1dpdGhDaGFuZ2VzICs9IG5leHREaWZmLm51bVN0YWNrc1dpdGhDaGFuZ2VzO1xuICAgICAgZm9ybWF0dGVkRGlmZiArPSBuZXh0RGlmZi5mb3JtYXR0ZWREaWZmO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBudW1TdGFja3NXaXRoQ2hhbmdlcyxcbiAgICAgIGZvcm1hdHRlZERpZmYsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JtYXQgdGhlIHNlY3VyaXR5IGRpZmZcbiAgICovXG4gIHB1YmxpYyBmb3JtYXRTZWN1cml0eURpZmYob3B0aW9uczogRm9ybWF0U2VjdXJpdHlEaWZmT3B0aW9ucyk6IEZvcm1hdFNlY3VyaXR5RGlmZk91dHB1dCB7XG4gICAgY29uc3QgaW9EZWZhdWx0SGVscGVyID0gbmV3IElvRGVmYXVsdE1lc3NhZ2VzKHRoaXMuaW9IZWxwZXIpO1xuXG4gICAgY29uc3QgZGlmZiA9IGZ1bGxEaWZmKHRoaXMub2xkVGVtcGxhdGUsIHRoaXMubmV3VGVtcGxhdGUudGVtcGxhdGUsIHRoaXMuY2hhbmdlU2V0KTtcbiAgICB0aGlzLl9kaWZmc1t0aGlzLnN0YWNrTmFtZV0gPSBkaWZmO1xuXG4gICAgaWYgKGRpZmZSZXF1aXJlc0FwcHJvdmFsKGRpZmYsIG9wdGlvbnMucmVxdWlyZUFwcHJvdmFsKSkge1xuICAgICAgLy8gVGhlIHNlY3VyaXR5IGRpZmYgaXMgZm9ybWF0dGVkIHZpYSBgRm9ybWF0dGVyYCwgd2hpY2ggdGFrZXMgaW4gYSBzdHJlYW1cbiAgICAgIC8vIGFuZCBzZW5kcyBpdHMgb3V0cHV0IGRpcmVjdGx5IHRvIHRoYXQgc3RyZWFtLiBUbyBmYWNpbGlhdGUgdXNlIG9mIHRoZVxuICAgICAgLy8gZ2xvYmFsIENsaUlvSG9zdCwgd2UgY3JlYXRlIG91ciBvd24gc3RyZWFtIHRvIGNhcHR1cmUgdGhlIG91dHB1dCBvZlxuICAgICAgLy8gYEZvcm1hdHRlcmAgYW5kIHJldHVybiB0aGUgb3V0cHV0IGFzIGEgc3RyaW5nIGZvciB0aGUgY29uc3VtZXIgb2ZcbiAgICAgIC8vIGBmb3JtYXRTZWN1cml0eURpZmZgIHRvIGRlY2lkZSB3aGF0IHRvIGRvIHdpdGggaXQuXG4gICAgICBjb25zdCBzdHJlYW0gPSBuZXcgU3RyaW5nV3JpdGVTdHJlYW0oKTtcblxuICAgICAgc3RyZWFtLndyaXRlKGZvcm1hdChgU3RhY2sgJHtjaGFsay5ib2xkKHRoaXMuc3RhY2tOYW1lKX1cXG5gKSk7XG5cbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBtYXgtbGVuXG4gICAgICBpb0RlZmF1bHRIZWxwZXIud2FybmluZyhgVGhpcyBkZXBsb3ltZW50IHdpbGwgbWFrZSBwb3RlbnRpYWxseSBzZW5zaXRpdmUgY2hhbmdlcyBhY2NvcmRpbmcgdG8geW91ciBjdXJyZW50IHNlY3VyaXR5IGFwcHJvdmFsIGxldmVsICgtLXJlcXVpcmUtYXBwcm92YWwgJHtvcHRpb25zLnJlcXVpcmVBcHByb3ZhbH0pLmApO1xuICAgICAgaW9EZWZhdWx0SGVscGVyLndhcm5pbmcoJ1BsZWFzZSBjb25maXJtIHlvdSBpbnRlbmQgdG8gbWFrZSB0aGUgZm9sbG93aW5nIG1vZGlmaWNhdGlvbnM6XFxuJyk7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBmb3JtYXRTZWN1cml0eUNoYW5nZXMgdXBkYXRlcyB0aGUgc3RyZWFtIHdpdGggdGhlIGZvcm1hdHRlZCBzZWN1cml0eSBkaWZmXG4gICAgICAgIGZvcm1hdFNlY3VyaXR5Q2hhbmdlcyhzdHJlYW0sIGRpZmYsIGJ1aWxkTG9naWNhbFRvUGF0aE1hcCh0aGlzLm5ld1RlbXBsYXRlKSk7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBzdHJlYW0uZW5kKCk7XG4gICAgICB9XG4gICAgICAvLyBzdG9yZSB0aGUgc3RyZWFtIGNvbnRhaW5pbmcgYSBmb3JtYXR0ZWQgc3RhY2sgZGlmZlxuICAgICAgY29uc3QgZm9ybWF0dGVkRGlmZiA9IHN0cmVhbS50b1N0cmluZygpO1xuICAgICAgcmV0dXJuIHsgZm9ybWF0dGVkRGlmZiB9O1xuICAgIH1cbiAgICByZXR1cm4ge307XG4gIH1cblxuICBwdWJsaWMgZm9ybWF0U3RhY2tEcmlmdChvcHRpb25zOiBGb3JtYXRTdGFja0RyaWZ0T3B0aW9ucyk6IEZvcm1hdFN0YWNrRHJpZnRPdXRwdXQge1xuICAgIGNvbnN0IHN0cmVhbSA9IG5ldyBTdHJpbmdXcml0ZVN0cmVhbSgpO1xuICAgIGxldCBkcmlmdENvdW50ID0gMDtcblxuICAgIGlmICghdGhpcy5kcmlmdFJlc3VsdHM/LlN0YWNrUmVzb3VyY2VEcmlmdHMpIHtcbiAgICAgIHJldHVybiB7IGZvcm1hdHRlZERyaWZ0OiAnJywgbnVtUmVzb3VyY2VzV2l0aERyaWZ0OiAwIH07XG4gICAgfVxuXG4gICAgY29uc3QgZHJpZnRzID0gdGhpcy5kcmlmdFJlc3VsdHMuU3RhY2tSZXNvdXJjZURyaWZ0cy5maWx0ZXIoZCA9PlxuICAgICAgZC5TdGFja1Jlc291cmNlRHJpZnRTdGF0dXMgPT09ICdNT0RJRklFRCcgfHxcbiAgICAgIGQuU3RhY2tSZXNvdXJjZURyaWZ0U3RhdHVzID09PSAnREVMRVRFRCcsXG4gICAgKTtcblxuICAgIGlmIChkcmlmdHMubGVuZ3RoID09PSAwICYmICFvcHRpb25zLnF1aWV0KSB7XG4gICAgICBzdHJlYW0ud3JpdGUoY2hhbGsuZ3JlZW4oJ05vIGRyaWZ0IGRldGVjdGVkXFxuJykpO1xuICAgICAgc3RyZWFtLmVuZCgpO1xuICAgICAgcmV0dXJuIHsgZm9ybWF0dGVkRHJpZnQ6IHN0cmVhbS50b1N0cmluZygpLCBudW1SZXNvdXJjZXNXaXRoRHJpZnQ6IDAgfTtcbiAgICB9XG5cbiAgICBkcmlmdENvdW50ID0gZHJpZnRzLmxlbmd0aDtcbiAgICBmb3JtYXRTdGFja0RyaWZ0Q2hhbmdlcyhzdHJlYW0sIHRoaXMuZHJpZnRSZXN1bHRzLCBidWlsZExvZ2ljYWxUb1BhdGhNYXAodGhpcy5uZXdUZW1wbGF0ZSkpO1xuICAgIHN0cmVhbS53cml0ZShjaGFsay55ZWxsb3coYFxcbiR7ZHJpZnRDb3VudH0gcmVzb3VyY2Uke2RyaWZ0Q291bnQgPT09IDEgPyAnJyA6ICdzJ30gJHtkcmlmdENvdW50ID09PSAxID8gJ2hhcycgOiAnaGF2ZSd9IGRyaWZ0ZWQgZnJvbSB0aGVpciBleHBlY3RlZCBjb25maWd1cmF0aW9uXFxuYCkpO1xuICAgIHN0cmVhbS5lbmQoKTtcblxuICAgIHJldHVybiB7XG4gICAgICBmb3JtYXR0ZWREcmlmdDogc3RyZWFtLnRvU3RyaW5nKCksXG4gICAgICBudW1SZXNvdXJjZXNXaXRoRHJpZnQ6IGRyaWZ0Q291bnQsXG4gICAgfTtcbiAgfVxufVxuXG4vKipcbiAqIFJldHVybiB3aGV0aGVyIHRoZSBkaWZmIGhhcyBzZWN1cml0eS1pbXBhY3RpbmcgY2hhbmdlcyB0aGF0IG5lZWQgY29uZmlybWF0aW9uXG4gKlxuICogVE9ETzogRmlsdGVyIHRoZSBzZWN1cml0eSBpbXBhY3QgZGV0ZXJtaW5hdGlvbiBiYXNlZCBvZmYgb2YgYW4gZW51bSB0aGF0IGFsbG93c1xuICogdXMgdG8gcGljayBtaW5pbXVtIFwic2V2ZXJpdGllc1wiIHRvIGFsZXJ0IG9uLlxuICovXG5mdW5jdGlvbiBkaWZmUmVxdWlyZXNBcHByb3ZhbChkaWZmOiBUZW1wbGF0ZURpZmYsIHJlcXVpcmVBcHByb3ZhbDogUmVxdWlyZUFwcHJvdmFsKSB7XG4gIHN3aXRjaCAocmVxdWlyZUFwcHJvdmFsKSB7XG4gICAgY2FzZSBSZXF1aXJlQXBwcm92YWwuTkVWRVI6IHJldHVybiBmYWxzZTtcbiAgICBjYXNlIFJlcXVpcmVBcHByb3ZhbC5BTllfQ0hBTkdFOiByZXR1cm4gZGlmZi5wZXJtaXNzaW9uc0FueUNoYW5nZXM7XG4gICAgY2FzZSBSZXF1aXJlQXBwcm92YWwuQlJPQURFTklORzogcmV0dXJuIGRpZmYucGVybWlzc2lvbnNCcm9hZGVuZWQ7XG4gICAgZGVmYXVsdDogdGhyb3cgbmV3IFRvb2xraXRFcnJvcihgVW5yZWNvZ25pemVkIGFwcHJvdmFsIGxldmVsOiAke3JlcXVpcmVBcHByb3ZhbH1gKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBidWlsZExvZ2ljYWxUb1BhdGhNYXAoc3RhY2s6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCkge1xuICBjb25zdCBtYXA6IHsgW2lkOiBzdHJpbmddOiBzdHJpbmcgfSA9IHt9O1xuICBmb3IgKGNvbnN0IG1kIG9mIHN0YWNrLmZpbmRNZXRhZGF0YUJ5VHlwZShjeHNjaGVtYS5BcnRpZmFjdE1ldGFkYXRhRW50cnlUeXBlLkxPR0lDQUxfSUQpKSB7XG4gICAgbWFwW21kLmRhdGEgYXMgc3RyaW5nXSA9IG1kLnBhdGg7XG4gIH1cbiAgcmV0dXJuIG1hcDtcbn1cblxuZnVuY3Rpb24gbG9naWNhbElkTWFwRnJvbVRlbXBsYXRlKHRlbXBsYXRlOiBhbnkpIHtcbiAgY29uc3QgcmV0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG5cbiAgZm9yIChjb25zdCBbbG9naWNhbElkLCByZXNvdXJjZV0gb2YgT2JqZWN0LmVudHJpZXModGVtcGxhdGUuUmVzb3VyY2VzID8/IHt9KSkge1xuICAgIGNvbnN0IHBhdGggPSAocmVzb3VyY2UgYXMgYW55KT8uTWV0YWRhdGE/LlsnYXdzOmNkazpwYXRoJ107XG4gICAgaWYgKHBhdGgpIHtcbiAgICAgIHJldFtsb2dpY2FsSWRdID0gcGF0aDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJldDtcbn1cblxuLyoqXG4gKiBSZW1vdmUgYW55IHRlbXBsYXRlIGVsZW1lbnRzIHRoYXQgd2UgZG9uJ3Qgd2FudCB0byBzaG93IHVzZXJzLlxuICogVGhpcyBpcyBjdXJyZW50bHk6XG4gKiAtIEFXUzo6Q0RLOjpNZXRhZGF0YSByZXNvdXJjZVxuICogLSBDaGVja0Jvb3RzdHJhcFZlcnNpb24gUnVsZVxuICovXG5mdW5jdGlvbiBvYnNjdXJlRGlmZihkaWZmOiBUZW1wbGF0ZURpZmYpIHtcbiAgaWYgKGRpZmYudW5rbm93bikge1xuICAgIC8vIHNlZSBodHRwczovL2dpdGh1Yi5jb20vYXdzL2F3cy1jZGsvaXNzdWVzLzE3OTQyXG4gICAgZGlmZi51bmtub3duID0gZGlmZi51bmtub3duLmZpbHRlcihjaGFuZ2UgPT4ge1xuICAgICAgaWYgKCFjaGFuZ2UpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICBpZiAoY2hhbmdlLm5ld1ZhbHVlPy5DaGVja0Jvb3RzdHJhcFZlcnNpb24pIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgaWYgKGNoYW5nZS5vbGRWYWx1ZT8uQ2hlY2tCb290c3RyYXBWZXJzaW9uKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICB9XG5cbiAgaWYgKGRpZmYucmVzb3VyY2VzKSB7XG4gICAgZGlmZi5yZXNvdXJjZXMgPSBkaWZmLnJlc291cmNlcy5maWx0ZXIoY2hhbmdlID0+IHtcbiAgICAgIGlmICghY2hhbmdlKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNoYW5nZS5uZXdSZXNvdXJjZVR5cGUgPT09ICdBV1M6OkNESzo6TWV0YWRhdGEnKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGlmIChjaGFuZ2Uub2xkUmVzb3VyY2VUeXBlID09PSAnQVdTOjpDREs6Ok1ldGFkYXRhJykge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9KTtcbiAgfVxufVxuIl19