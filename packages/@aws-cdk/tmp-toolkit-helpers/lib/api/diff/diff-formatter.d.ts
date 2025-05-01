import { type TemplateDiff } from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import type { DescribeStackResourceDriftsCommandOutput } from '@aws-sdk/client-cloudformation';
import type { NestedStackTemplates } from '../cloudformation';
import type { IoHelper } from '../io/private';
import { RequireApproval } from '../require-approval';
/**
 * Output of formatSecurityDiff
 */
interface FormatSecurityDiffOutput {
    /**
     * Complete formatted security diff, if it is prompt-worthy
     */
    readonly formattedDiff?: string;
}
/**
 * Output of formatStackDiff
 */
interface FormatStackDiffOutput {
    /**
     * Number of stacks with diff changes
     */
    readonly numStacksWithChanges: number;
    /**
     * Complete formatted diff
     */
    readonly formattedDiff: string;
}
/**
 * Output of formatStackDrift
 */
interface FormatStackDriftOutput {
    /**
     * Number of stacks with drift
     */
    readonly numResourcesWithDrift: number;
    /**
     * Complete formatted drift
     */
    readonly formattedDrift: string;
}
/**
 * Props for the Diff Formatter
 */
interface DiffFormatterProps {
    /**
     * Helper for the IoHost class
     */
    readonly ioHelper: IoHelper;
    /**
     * The relevant information for the Template that is being diffed.
     * Includes the old/current state of the stack as well as the new state.
     */
    readonly templateInfo: TemplateInfo;
    /**
     * The results of stack drift
     */
    readonly driftResults?: DescribeStackResourceDriftsCommandOutput;
}
/**
 * Properties specific to formatting the security diff
 */
interface FormatSecurityDiffOptions {
    /**
     * The approval level of the security diff
     */
    readonly requireApproval: RequireApproval;
}
/**
 * Properties specific to formatting the stack diff
 */
interface FormatStackDiffOptions {
    /**
     * do not filter out AWS::CDK::Metadata or Rules
     *
     * @default false
     */
    readonly strict?: boolean;
    /**
     * lines of context to use in arbitrary JSON diff
     *
     * @default 3
     */
    readonly context?: number;
    /**
     * silences \'There were no differences\' messages
     *
     * @default false
     */
    readonly quiet?: boolean;
}
/**
 * Properties specific to formatting the stack drift diff
 */
interface FormatStackDriftOptions {
    /**
     * Silences 'There were no differences' messages
     */
    readonly quiet?: boolean;
}
/**
 * Information on a template's old/new state
 * that is used for diff.
 */
export interface TemplateInfo {
    /**
     * The old/existing template
     */
    readonly oldTemplate: any;
    /**
     * The new template
     */
    readonly newTemplate: cxapi.CloudFormationStackArtifact;
    /**
     * A CloudFormation ChangeSet to help the diff operation.
     * Probably created via `createDiffChangeSet`.
     *
     * @default undefined
     */
    readonly changeSet?: any;
    /**
     * Whether or not there are any imported resources
     *
     * @default false
     */
    readonly isImport?: boolean;
    /**
     * Any nested stacks included in the template
     *
     * @default {}
     */
    readonly nestedStacks?: {
        [nestedStackLogicalId: string]: NestedStackTemplates;
    };
}
/**
 * Class for formatting the diff output
 */
export declare class DiffFormatter {
    private readonly ioHelper;
    private readonly oldTemplate;
    private readonly newTemplate;
    private readonly stackName;
    private readonly changeSet?;
    private readonly nestedStacks;
    private readonly driftResults?;
    private readonly isImport;
    /**
     * Stores the TemplateDiffs that get calculated in this DiffFormatter,
     * indexed by the stack name.
     */
    private _diffs;
    constructor(props: DiffFormatterProps);
    get diffs(): {
        [name: string]: TemplateDiff;
    };
    /**
     * Format the stack diff
     */
    formatStackDiff(options?: FormatStackDiffOptions): FormatStackDiffOutput;
    private formatStackDiffHelper;
    /**
     * Format the security diff
     */
    formatSecurityDiff(options: FormatSecurityDiffOptions): FormatSecurityDiffOutput;
    formatStackDrift(options: FormatStackDriftOptions): FormatStackDriftOutput;
}
export {};
