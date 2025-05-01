import type { ToolkitAction } from './toolkit-action';
/**
 * The reporting level of the message.
 * All messages are always reported, it's up to the IoHost to decide what to log.
 */
export type IoMessageLevel = 'error' | 'result' | 'warn' | 'info' | 'debug' | 'trace';
/**
 * A valid message code.
 */
export type IoMessageCode = `CDK_${string}_${'E' | 'W' | 'I'}${number}${number}${number}${number}`;
/**
 * An IO message emitted.
 */
export interface IoMessage<T> {
    /**
     * The time the message was emitted.
     */
    readonly time: Date;
    /**
     * The recommended log level of the message.
     *
     * This is an indicative level and should not be used to explicitly match messages, instead match the `code`.
     * The level of a message may change without notice.
     */
    readonly level: IoMessageLevel;
    /**
     * The action that triggered the message.
     */
    readonly action: ToolkitAction;
    /**
     * A short message code uniquely identifying a message type using the format CDK_[CATEGORY]_[E/W/I][0000-9999].
     *
     * The level indicator follows these rules:
     * - 'E' for error level messages
     * - 'W' for warning level messages
     * - 'I' for info/debug/trace level messages
     *
     * Codes ending in 000 0 are generic messages, while codes ending in 0001-9999 are specific to a particular message.
     * The following are examples of valid and invalid message codes:
     * ```ts
     * 'CDK_ASSETS_I0000'       // valid: generic assets info message
     * 'CDK_TOOLKIT_E0002'      // valid: specific toolkit error message
     * 'CDK_SDK_W0023'          // valid: specific sdk warning message
     * ```
     *
     * @see https://github.com/aws/aws-cdk-cli/blob/main/packages/%40aws-cdk/toolkit-lib/CODE_REGISTRY.md
     */
    readonly code: IoMessageCode;
    /**
     * The message text.
     * This is safe to print to an end-user.
     */
    readonly message: string;
    /**
     * Identifies the message span, this message belongs to.
     *
     * A message span, groups multiple messages together that semantically related to the same operation.
     * This is an otherwise meaningless identifier.
     *
     * A message without a `spanId`, does not belong to a span.
     */
    readonly span?: string;
    /**
     * The data attached to the message.
     */
    readonly data: T;
}
/**
 * An IO request emitted.
 */
export interface IoRequest<T, U> extends IoMessage<T> {
    /**
     * The default response that will be used if no data is returned.
     */
    readonly defaultResponse: U;
}
