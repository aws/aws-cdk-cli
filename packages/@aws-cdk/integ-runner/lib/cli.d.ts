export declare function parseCliArgs(args?: string[]): {
    tests: string[] | undefined;
    app: (string | undefined);
    testRegex: string[] | undefined;
    testRegions: string[];
    originalRegions: string[] | undefined;
    profiles: string[] | undefined;
    runUpdateOnFailed: boolean;
    fromFile: string | undefined;
    exclude: boolean;
    maxWorkers: number;
    list: boolean;
    directory: string;
    inspectFailures: boolean;
    verbosity: number;
    verbose: boolean;
    clean: boolean;
    force: boolean;
    dryRun: boolean;
    disableUpdateWorkflow: boolean;
    language: string[] | undefined;
    watch: boolean;
};
export declare function main(args: string[]): Promise<void>;
export declare function cli(args?: string[]): void;
