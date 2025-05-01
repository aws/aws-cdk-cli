import type { Environment } from '@aws-cdk/cx-api';
import type { SdkHttpOptions } from './aws-auth';
import type { Context } from './context';
import type { IIoHost } from './io';
import type { IoHelper } from './io/private';
import { IoDefaultMessages } from './io/private';
export interface NoticesProps {
    /**
     * CDK context
     */
    readonly context: Context;
    /**
     * Include notices that have already been acknowledged.
     *
     * @default false
     */
    readonly includeAcknowledged?: boolean;
    /**
     * Global CLI option for output directory for synthesized cloud assembly
     *
     * @default 'cdk.out'
     */
    readonly output?: string;
    /**
     * Options for the HTTP request
     */
    readonly httpOptions?: SdkHttpOptions;
    /**
     * Where messages are going to be sent
     */
    readonly ioHost: IIoHost;
    /**
     * The version of the CLI
     */
    readonly cliVersion: string;
}
export interface NoticesPrintOptions {
    /**
     * Whether to append the total number of unacknowledged notices to the display.
     *
     * @default false
     */
    readonly showTotal?: boolean;
}
export interface NoticesRefreshOptions {
    /**
     * Whether to force a cache refresh regardless of expiration time.
     *
     * @default false
     */
    readonly force?: boolean;
    /**
     * Data source for fetch notices from.
     *
     * @default - WebsiteNoticeDataSource
     */
    readonly dataSource?: NoticeDataSource;
}
export interface NoticesFilterFilterOptions {
    readonly data: Notice[];
    readonly cliVersion: string;
    readonly outDir: string;
    readonly bootstrappedEnvironments: BootstrappedEnvironment[];
}
export declare class NoticesFilter {
    private readonly ioMessages;
    constructor(ioMessages: IoDefaultMessages);
    filter(options: NoticesFilterFilterOptions): FilteredNotice[];
    /**
     * From a set of input options, return the notices components we are searching for
     */
    private otherComponents;
    /**
     * Based on a set of component names, find all notices that match one of the given components
     */
    private findForNamedComponents;
    /**
     * Whether the given "affected component" name applies to the given actual component name.
     *
     * The name matches if the name is exactly the same, or the name in the notice
     * is a prefix of the node name when the query ends in '.'.
     */
    private componentNameMatches;
    /**
     * Adds dynamic values from the given ActualComponents
     *
     * If there are multiple components with the same dynamic name, they are joined
     * by a comma.
     */
    private addDynamicValues;
    /**
     * Treat 'framework' as an alias for either `aws-cdk-lib.` or `@aws-cdk/core.`.
     *
     * Because it's EITHER `aws-cdk-lib` or `@aws-cdk/core`, we need to add multiple
     * arrays at the top level.
     */
    private resolveAliases;
    /**
     * Load the construct tree from the given directory and return its components
     */
    private constructTreeComponents;
}
/**
 * Information about a bootstrapped environment.
 */
export interface BootstrappedEnvironment {
    readonly bootstrapStackVersion: number;
    readonly environment: Environment;
}
/**
 * Provides access to notices the CLI can display.
 */
export declare class Notices {
    /**
     * Create an instance. Note that this replaces the singleton.
     */
    static create(props: NoticesProps): Notices;
    /**
     * Get the singleton instance. May return `undefined` if `create` has not been called.
     */
    static get(): Notices | undefined;
    private static _instance;
    private readonly context;
    private readonly output;
    private readonly acknowledgedIssueNumbers;
    private readonly includeAcknowlegded;
    private readonly httpOptions;
    private readonly ioHelper;
    private readonly ioMessages;
    private readonly cliVersion;
    private data;
    private readonly bootstrappedEnvironments;
    private constructor();
    /**
     * Add a bootstrap information to filter on. Can have multiple values
     * in case of multi-environment deployments.
     */
    addBootstrappedEnvironment(bootstrapped: BootstrappedEnvironment): void;
    /**
     * Refresh the list of notices this instance is aware of.
     * To make sure this never crashes the CLI process, all failures are caught and
     * silently logged.
     *
     * If context is configured to not display notices, this will no-op.
     */
    refresh(options?: NoticesRefreshOptions): Promise<void>;
    /**
     * Display the relevant notices (unless context dictates we shouldn't).
     */
    display(options?: NoticesPrintOptions): void;
}
export interface Component {
    name: string;
    /**
     * The range of affected versions
     */
    version: string;
}
export interface Notice {
    title: string;
    issueNumber: number;
    overview: string;
    /**
     * A set of affected components
     *
     * The canonical form of a list of components is in Disjunctive Normal Form
     * (i.e., an OR of ANDs). This is the form when the list of components is a
     * doubly nested array: the notice matches if all components of at least one
     * of the top-level array matches.
     *
     * If the `components` is a single-level array, it is evaluated as an OR; it
     * matches if any of the components matches.
     */
    components: Array<Component | Component[]>;
    schemaVersion: string;
    severity?: string;
}
/**
 * Notice after passing the filter. A filter can augment a notice with
 * dynamic values as it has access to the dynamic matching data.
 */
export declare class FilteredNotice {
    readonly notice: Notice;
    private readonly dynamicValues;
    constructor(notice: Notice);
    addDynamicValue(key: string, value: string): void;
    format(): string;
    private formatOverview;
    private resolveDynamicValues;
}
export interface NoticeDataSource {
    fetch(): Promise<Notice[]>;
}
export declare class WebsiteNoticeDataSource implements NoticeDataSource {
    private readonly ioHelper;
    private readonly options;
    constructor(ioHelper: IoHelper, options?: SdkHttpOptions);
    fetch(): Promise<Notice[]>;
}
export declare class CachedDataSource implements NoticeDataSource {
    private readonly ioMessages;
    private readonly fileName;
    private readonly dataSource;
    private readonly skipCache?;
    constructor(ioMessages: IoDefaultMessages, fileName: string, dataSource: NoticeDataSource, skipCache?: boolean | undefined);
    fetch(): Promise<Notice[]>;
    private fetchInner;
    private load;
    private save;
}
