import { type Stack } from '@aws-sdk/client-cloudformation';
/**
 * A utility class to inspect CloudFormation stack statuses.
 *
 * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-describing-stacks.html
 */
export declare class StackStatus {
    readonly name: string;
    readonly reason?: string | undefined;
    static fromStackDescription(description: Stack): StackStatus;
    constructor(name: string, reason?: string | undefined);
    get isCreationFailure(): boolean;
    get isDeleted(): boolean;
    get isFailure(): boolean;
    get isInProgress(): boolean;
    get isReviewInProgress(): boolean;
    get isNotFound(): boolean;
    get isDeploySuccess(): boolean;
    get isRollbackSuccess(): boolean;
    /**
     * Whether the stack is in a paused state due to `--no-rollback`.
     *
     * The possible actions here are retrying a new `--no-rollback` deployment, or initiating a rollback.
     */
    get rollbackChoice(): RollbackChoice;
    get isRollbackable(): boolean;
    toString(): string;
}
/**
 * Describe the current rollback options for this state
 */
export declare enum RollbackChoice {
    START_ROLLBACK = 0,
    CONTINUE_UPDATE_ROLLBACK = 1,
    /**
     * A sign that stack creation AND its rollback have failed.
     *
     * There is no way to recover from this, other than recreating the stack.
     */
    ROLLBACK_FAILED = 2,
    NONE = 3
}
