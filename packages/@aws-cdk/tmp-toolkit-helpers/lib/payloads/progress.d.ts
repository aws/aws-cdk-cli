export interface StackProgress {
    /**
     * The total number of progress monitored resources.
     */
    readonly total?: number;
    /**
     * The number of completed resources.
     */
    readonly completed: number;
    /**
     * The current progress as a [34/42] string, or just [34] if the total is unknown.
     */
    readonly formatted: string;
}
