"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CachedDataSource = exports.WebsiteNoticeDataSource = exports.FilteredNotice = exports.Notices = exports.NoticesFilter = void 0;
const https = require("node:https");
const path = require("path");
const fs = require("fs-extra");
const semver = require("semver");
const aws_auth_1 = require("./aws-auth");
const private_1 = require("./io/private");
const toolkit_error_1 = require("./toolkit-error");
const tree_1 = require("./tree");
const util_1 = require("../util");
const CACHE_FILE_PATH = path.join((0, util_1.cdkCacheDir)(), 'notices.json');
class NoticesFilter {
    ioMessages;
    constructor(ioMessages) {
        this.ioMessages = ioMessages;
    }
    filter(options) {
        const components = [
            ...this.constructTreeComponents(options.outDir),
            ...this.otherComponents(options),
        ];
        return this.findForNamedComponents(options.data, components);
    }
    /**
     * From a set of input options, return the notices components we are searching for
     */
    otherComponents(options) {
        return [
            // CLI
            {
                name: 'cli',
                version: options.cliVersion,
            },
            // Node version
            {
                name: 'node',
                version: process.version.replace(/^v/, ''), // remove the 'v' prefix.
                dynamicName: 'node',
            },
            // Bootstrap environments
            ...options.bootstrappedEnvironments.flatMap(env => {
                const semverBootstrapVersion = semver.coerce(env.bootstrapStackVersion);
                if (!semverBootstrapVersion) {
                    // we don't throw because notices should never crash the cli.
                    this.ioMessages.warning(`While filtering notices, could not coerce bootstrap version '${env.bootstrapStackVersion}' into semver`);
                    return [];
                }
                return [{
                        name: 'bootstrap',
                        version: `${semverBootstrapVersion}`,
                        dynamicName: 'ENVIRONMENTS',
                        dynamicValue: env.environment.name,
                    }];
            }),
        ];
    }
    /**
     * Based on a set of component names, find all notices that match one of the given components
     */
    findForNamedComponents(data, actualComponents) {
        return data.flatMap(notice => {
            const ors = this.resolveAliases(normalizeComponents(notice.components));
            // Find the first set of the disjunctions of which all components match against the actual components.
            // Return the actual components we found so that we can inject their dynamic values. A single filter
            // component can match more than one actual component
            for (const ands of ors) {
                const matched = ands.map(affected => actualComponents.filter(actual => this.componentNameMatches(affected, actual) && semver.satisfies(actual.version, affected.version, { includePrerelease: true })));
                // For every clause in the filter we matched one or more components
                if (matched.every(xs => xs.length > 0)) {
                    const ret = new FilteredNotice(notice);
                    this.addDynamicValues(matched.flatMap(x => x), ret);
                    return [ret];
                }
            }
            return [];
        });
    }
    /**
     * Whether the given "affected component" name applies to the given actual component name.
     *
     * The name matches if the name is exactly the same, or the name in the notice
     * is a prefix of the node name when the query ends in '.'.
     */
    componentNameMatches(pattern, actual) {
        return pattern.name.endsWith('.') ? actual.name.startsWith(pattern.name) : pattern.name === actual.name;
    }
    /**
     * Adds dynamic values from the given ActualComponents
     *
     * If there are multiple components with the same dynamic name, they are joined
     * by a comma.
     */
    addDynamicValues(comps, notice) {
        const dynamicValues = {};
        for (const comp of comps) {
            if (comp.dynamicName) {
                dynamicValues[comp.dynamicName] = dynamicValues[comp.dynamicName] ?? [];
                dynamicValues[comp.dynamicName].push(comp.dynamicValue ?? comp.version);
            }
        }
        for (const [key, values] of Object.entries(dynamicValues)) {
            notice.addDynamicValue(key, values.join(','));
        }
    }
    /**
     * Treat 'framework' as an alias for either `aws-cdk-lib.` or `@aws-cdk/core.`.
     *
     * Because it's EITHER `aws-cdk-lib` or `@aws-cdk/core`, we need to add multiple
     * arrays at the top level.
     */
    resolveAliases(ors) {
        return ors.flatMap(ands => {
            const hasFramework = ands.find(c => c.name === 'framework');
            if (!hasFramework) {
                return [ands];
            }
            return [
                ands.map(c => c.name === 'framework' ? { ...c, name: '@aws-cdk/core.' } : c),
                ands.map(c => c.name === 'framework' ? { ...c, name: 'aws-cdk-lib.' } : c),
            ];
        });
    }
    /**
     * Load the construct tree from the given directory and return its components
     */
    constructTreeComponents(manifestDir) {
        const tree = (0, tree_1.loadTreeFromDir)(manifestDir, (msg) => void this.ioMessages.notify(private_1.IO.DEFAULT_ASSEMBLY_TRACE.msg(msg)));
        if (!tree) {
            return [];
        }
        const ret = [];
        recurse(tree);
        return ret;
        function recurse(x) {
            if (x.constructInfo?.fqn && x.constructInfo?.version) {
                ret.push({
                    name: x.constructInfo?.fqn,
                    version: x.constructInfo?.version,
                });
            }
            for (const child of Object.values(x.children ?? {})) {
                recurse(child);
            }
        }
    }
}
exports.NoticesFilter = NoticesFilter;
/**
 * Provides access to notices the CLI can display.
 */
class Notices {
    /**
     * Create an instance. Note that this replaces the singleton.
     */
    static create(props) {
        this._instance = new Notices(props);
        return this._instance;
    }
    /**
     * Get the singleton instance. May return `undefined` if `create` has not been called.
     */
    static get() {
        return this._instance;
    }
    static _instance;
    context;
    output;
    acknowledgedIssueNumbers;
    includeAcknowlegded;
    httpOptions;
    ioHelper;
    ioMessages;
    cliVersion;
    data = new Set();
    // sets don't deduplicate interfaces, so we use a map.
    bootstrappedEnvironments = new Map();
    constructor(props) {
        this.context = props.context;
        this.acknowledgedIssueNumbers = new Set(this.context.get('acknowledged-issue-numbers') ?? []);
        this.includeAcknowlegded = props.includeAcknowledged ?? false;
        this.output = props.output ?? 'cdk.out';
        this.httpOptions = props.httpOptions ?? {};
        this.ioHelper = (0, private_1.asIoHelper)(props.ioHost, 'notices' /* forcing a CliAction to a ToolkitAction */);
        this.ioMessages = new private_1.IoDefaultMessages(this.ioHelper);
        this.cliVersion = props.cliVersion;
    }
    /**
     * Add a bootstrap information to filter on. Can have multiple values
     * in case of multi-environment deployments.
     */
    addBootstrappedEnvironment(bootstrapped) {
        const key = [
            bootstrapped.bootstrapStackVersion,
            bootstrapped.environment.account,
            bootstrapped.environment.region,
            bootstrapped.environment.name,
        ].join(':');
        this.bootstrappedEnvironments.set(key, bootstrapped);
    }
    /**
     * Refresh the list of notices this instance is aware of.
     * To make sure this never crashes the CLI process, all failures are caught and
     * silently logged.
     *
     * If context is configured to not display notices, this will no-op.
     */
    async refresh(options = {}) {
        try {
            const underlyingDataSource = options.dataSource ?? new WebsiteNoticeDataSource(this.ioHelper, this.httpOptions);
            const dataSource = new CachedDataSource(this.ioMessages, CACHE_FILE_PATH, underlyingDataSource, options.force ?? false);
            const notices = await dataSource.fetch();
            this.data = new Set(this.includeAcknowlegded ? notices : notices.filter(n => !this.acknowledgedIssueNumbers.has(n.issueNumber)));
        }
        catch (e) {
            this.ioMessages.debug(`Could not refresh notices: ${e}`);
        }
    }
    /**
     * Display the relevant notices (unless context dictates we shouldn't).
     */
    display(options = {}) {
        const filteredNotices = new NoticesFilter(this.ioMessages).filter({
            data: Array.from(this.data),
            cliVersion: this.cliVersion,
            outDir: this.output,
            bootstrappedEnvironments: Array.from(this.bootstrappedEnvironments.values()),
        });
        if (filteredNotices.length > 0) {
            void this.ioMessages.notify(private_1.IO.CDK_TOOLKIT_I0100.msg([
                '',
                'NOTICES         (What\'s this? https://github.com/aws/aws-cdk/wiki/CLI-Notices)',
                '',
            ].join('\n')));
            for (const filtered of filteredNotices) {
                const formatted = filtered.format() + '\n';
                switch (filtered.notice.severity) {
                    case 'warning':
                        void this.ioMessages.notify(private_1.IO.CDK_TOOLKIT_W0101.msg(formatted));
                        break;
                    case 'error':
                        void this.ioMessages.notify(private_1.IO.CDK_TOOLKIT_E0101.msg(formatted));
                        break;
                    default:
                        void this.ioMessages.notify(private_1.IO.CDK_TOOLKIT_I0101.msg(formatted));
                        break;
                }
            }
            void this.ioMessages.notify(private_1.IO.CDK_TOOLKIT_I0100.msg(`If you don’t want to see a notice anymore, use "cdk acknowledge <id>". For example, "cdk acknowledge ${filteredNotices[0].notice.issueNumber}".`));
        }
        if (options.showTotal ?? false) {
            void this.ioMessages.notify(private_1.IO.CDK_TOOLKIT_I0100.msg(`\nThere are ${filteredNotices.length} unacknowledged notice(s).`));
        }
    }
}
exports.Notices = Notices;
/**
 * Normalizes the given components structure into DNF form
 */
function normalizeComponents(xs) {
    return xs.map(x => Array.isArray(x) ? x : [x]);
}
function renderConjunction(xs) {
    return xs.map(c => `${c.name}: ${c.version}`).join(' AND ');
}
/**
 * Notice after passing the filter. A filter can augment a notice with
 * dynamic values as it has access to the dynamic matching data.
 */
class FilteredNotice {
    notice;
    dynamicValues = {};
    constructor(notice) {
        this.notice = notice;
    }
    addDynamicValue(key, value) {
        this.dynamicValues[`{resolve:${key}}`] = value;
    }
    format() {
        const componentsValue = normalizeComponents(this.notice.components).map(renderConjunction).join(', ');
        return this.resolveDynamicValues([
            `${this.notice.issueNumber}\t${this.notice.title}`,
            this.formatOverview(),
            `\tAffected versions: ${componentsValue}`,
            `\tMore information at: https://github.com/aws/aws-cdk/issues/${this.notice.issueNumber}`,
        ].join('\n\n') + '\n');
    }
    formatOverview() {
        const wrap = (s) => s.replace(/(?![^\n]{1,60}$)([^\n]{1,60})\s/g, '$1\n');
        const heading = 'Overview: ';
        const separator = `\n\t${' '.repeat(heading.length)}`;
        const content = wrap(this.notice.overview)
            .split('\n')
            .join(separator);
        return '\t' + heading + content;
    }
    resolveDynamicValues(input) {
        const pattern = new RegExp(Object.keys(this.dynamicValues).join('|'), 'g');
        return input.replace(pattern, (matched) => this.dynamicValues[matched] ?? matched);
    }
}
exports.FilteredNotice = FilteredNotice;
class WebsiteNoticeDataSource {
    ioHelper;
    options;
    constructor(ioHelper, options = {}) {
        this.ioHelper = ioHelper;
        this.options = options;
    }
    async fetch() {
        const timeout = 3000;
        const options = {
            agent: await new aws_auth_1.ProxyAgentProvider(this.ioHelper).create(this.options),
        };
        const notices = await new Promise((resolve, reject) => {
            let req;
            let timer = setTimeout(() => {
                if (req) {
                    req.destroy(new toolkit_error_1.ToolkitError('Request timed out'));
                }
            }, timeout);
            timer.unref();
            try {
                req = https.get('https://cli.cdk.dev-tools.aws.dev/notices.json', options, res => {
                    if (res.statusCode === 200) {
                        res.setEncoding('utf8');
                        let rawData = '';
                        res.on('data', (chunk) => {
                            rawData += chunk;
                        });
                        res.on('end', () => {
                            try {
                                const data = JSON.parse(rawData).notices;
                                if (!data) {
                                    throw new toolkit_error_1.ToolkitError("'notices' key is missing");
                                }
                                resolve(data ?? []);
                            }
                            catch (e) {
                                reject(new toolkit_error_1.ToolkitError(`Failed to parse notices: ${(0, util_1.formatErrorMessage)(e)}`));
                            }
                        });
                        res.on('error', e => {
                            reject(new toolkit_error_1.ToolkitError(`Failed to fetch notices: ${(0, util_1.formatErrorMessage)(e)}`));
                        });
                    }
                    else {
                        reject(new toolkit_error_1.ToolkitError(`Failed to fetch notices. Status code: ${res.statusCode}`));
                    }
                });
                req.on('error', reject);
            }
            catch (e) {
                reject(new toolkit_error_1.ToolkitError(`HTTPS 'get' call threw an error: ${(0, util_1.formatErrorMessage)(e)}`));
            }
        });
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg('Notices refreshed'));
        return notices;
    }
}
exports.WebsiteNoticeDataSource = WebsiteNoticeDataSource;
const TIME_TO_LIVE_SUCCESS = 60 * 60 * 1000; // 1 hour
const TIME_TO_LIVE_ERROR = 1 * 60 * 1000; // 1 minute
class CachedDataSource {
    ioMessages;
    fileName;
    dataSource;
    skipCache;
    constructor(ioMessages, fileName, dataSource, skipCache) {
        this.ioMessages = ioMessages;
        this.fileName = fileName;
        this.dataSource = dataSource;
        this.skipCache = skipCache;
    }
    async fetch() {
        const cachedData = await this.load();
        const data = cachedData.notices;
        const expiration = cachedData.expiration ?? 0;
        if (Date.now() > expiration || this.skipCache) {
            const freshData = await this.fetchInner();
            await this.save(freshData);
            return freshData.notices;
        }
        else {
            this.ioMessages.debug(`Reading cached notices from ${this.fileName}`);
            return data;
        }
    }
    async fetchInner() {
        try {
            return {
                expiration: Date.now() + TIME_TO_LIVE_SUCCESS,
                notices: await this.dataSource.fetch(),
            };
        }
        catch (e) {
            this.ioMessages.debug(`Could not refresh notices: ${e}`);
            return {
                expiration: Date.now() + TIME_TO_LIVE_ERROR,
                notices: [],
            };
        }
    }
    async load() {
        const defaultValue = {
            expiration: 0,
            notices: [],
        };
        try {
            return fs.existsSync(this.fileName)
                ? await fs.readJSON(this.fileName)
                : defaultValue;
        }
        catch (e) {
            this.ioMessages.debug(`Failed to load notices from cache: ${e}`);
            return defaultValue;
        }
    }
    async save(cached) {
        try {
            await fs.writeJSON(this.fileName, cached);
        }
        catch (e) {
            this.ioMessages.debug(`Failed to store notices in the cache: ${e}`);
        }
    }
}
exports.CachedDataSource = CachedDataSource;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibm90aWNlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9hcGkvbm90aWNlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFQSxvQ0FBb0M7QUFDcEMsNkJBQTZCO0FBRTdCLCtCQUErQjtBQUMvQixpQ0FBaUM7QUFDakMseUNBQWdEO0FBS2hELDBDQUFpRTtBQUNqRSxtREFBK0M7QUFDL0MsaUNBQXlDO0FBRXpDLGtDQUEwRDtBQUUxRCxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUEsa0JBQVcsR0FBRSxFQUFFLGNBQWMsQ0FBQyxDQUFDO0FBdUVqRSxNQUFhLGFBQWE7SUFDSztJQUE3QixZQUE2QixVQUE2QjtRQUE3QixlQUFVLEdBQVYsVUFBVSxDQUFtQjtJQUMxRCxDQUFDO0lBRU0sTUFBTSxDQUFDLE9BQW1DO1FBQy9DLE1BQU0sVUFBVSxHQUFHO1lBQ2pCLEdBQUcsSUFBSSxDQUFDLHVCQUF1QixDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUM7WUFDL0MsR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLE9BQU8sQ0FBQztTQUNqQyxDQUFDO1FBRUYsT0FBTyxJQUFJLENBQUMsc0JBQXNCLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxVQUFVLENBQUMsQ0FBQztJQUMvRCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxlQUFlLENBQUMsT0FBbUM7UUFDekQsT0FBTztZQUNMLE1BQU07WUFDTjtnQkFDRSxJQUFJLEVBQUUsS0FBSztnQkFDWCxPQUFPLEVBQUUsT0FBTyxDQUFDLFVBQVU7YUFDNUI7WUFFRCxlQUFlO1lBQ2Y7Z0JBQ0UsSUFBSSxFQUFFLE1BQU07Z0JBQ1osT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsRUFBRSx5QkFBeUI7Z0JBQ3JFLFdBQVcsRUFBRSxNQUFNO2FBQ3BCO1lBRUQseUJBQXlCO1lBQ3pCLEdBQUcsT0FBTyxDQUFD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Q2IsT0FBTyxFQUFFLEVBQUU7U0FDWixDQUFDO1FBRUYsSUFBSSxDQUFDO1lBQ0gsT0FBTyxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7Z0JBQ2pDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBa0I7Z0JBQ25ELENBQUMsQ0FBQyxZQUFZLENBQUM7UUFDbkIsQ0FBQztRQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDWCxJQUFJLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxzQ0FBc0MsQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUNqRSxPQUFPLFlBQVksQ0FBQztRQUN0QixDQUFDO0lBQ0gsQ0FBQztJQUVPLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBcUI7UUFDdEMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxFQUFFLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDNUMsQ0FBQztRQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDWCxJQUFJLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyx5Q0FBeUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUN0RSxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBN0RELDRDQTZEQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQ2xpZW50UmVxdWVzdCB9IGZyb20gJ2h0dHAnO1xuaW1wb3J0IHR5cGUgeyBSZXF1ZXN0T3B0aW9ucyB9IGZyb20gJ2h0dHBzJztcbmltcG9ydCAqIGFzIGh0dHBzIGZyb20gJ25vZGU6aHR0cHMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB0eXBlIHsgRW52aXJvbm1lbnQgfSBmcm9tICdAYXdzLWNkay9jeC1hcGknO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0ICogYXMgc2VtdmVyIGZyb20gJ3NlbXZlcic7XG5pbXBvcnQgeyBQcm94eUFnZW50UHJvdmlkZXIgfSBmcm9tICcuL2F3cy1hdXRoJztcbmltcG9ydCB0eXBlIHsgU2RrSHR0cE9wdGlvbnMgfSBmcm9tICcuL2F3cy1hdXRoJztcbmltcG9ydCB0eXBlIHsgQ29udGV4dCB9IGZyb20gJy4vY29udGV4dCc7XG5pbXBvcnQgdHlwZSB7IElJb0hvc3QgfSBmcm9tICcuL2lvJztcbmltcG9ydCB0eXBlIHsgSW9IZWxwZXIgfSBmcm9tICcuL2lvL3ByaXZhdGUnO1xuaW1wb3J0IHsgSU8sIGFzSW9IZWxwZXIsIElvRGVmYXVsdE1lc3NhZ2VzIH0gZnJvbSAnLi9pby9wcml2YXRlJztcbmltcG9ydCB7IFRvb2xraXRFcnJvciB9IGZyb20gJy4vdG9vbGtpdC1lcnJvcic7XG5pbXBvcnQgeyBsb2FkVHJlZUZyb21EaXIgfSBmcm9tICcuL3RyZWUnO1xuaW1wb3J0IHR5cGUgeyBDb25zdHJ1Y3RUcmVlTm9kZSB9IGZyb20gJy4vdHJlZSc7XG5pbXBvcnQgeyBjZGtDYWNoZURpciwgZm9ybWF0RXJyb3JNZXNzYWdlIH0gZnJvbSAnLi4vdXRpbCc7XG5cbmNvbnN0IENBQ0hFX0ZJTEVfUEFUSCA9IHBhdGguam9pbihjZGtDYWNoZURpcigpLCAnbm90aWNlcy5qc29uJyk7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTm90aWNlc1Byb3BzIHtcbiAgLyoqXG4gICAqIENESyBjb250ZXh0XG4gICAqL1xuICByZWFkb25seSBjb250ZXh0OiBDb250ZXh0O1xuXG4gIC8qKlxuICAgKiBJbmNsdWRlIG5vdGljZXMgdGhhdCBoYXZlIGFscmVhZHkgYmVlbiBhY2tub3dsZWRnZWQuXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBpbmNsdWRlQWNrbm93bGVkZ2VkPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogR2xvYmFsIENMSSBvcHRpb24gZm9yIG91dHB1dCBkaXJlY3RvcnkgZm9yIHN5bnRoZXNpemVkIGNsb3VkIGFzc2VtYmx5XG4gICAqXG4gICAqIEBkZWZhdWx0ICdjZGsub3V0J1xuICAgKi9cbiAgcmVhZG9ubHkgb3V0cHV0Pzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBPcHRpb25zIGZvciB0aGUgSFRUUCByZXF1ZXN0XG4gICAqL1xuICByZWFkb25seSBodHRwT3B0aW9ucz86IFNka0h0dHBPcHRpb25zO1xuXG4gIC8qKlxuICAgKiBXaGVyZSBtZXNzYWdlcyBhcmUgZ29pbmcgdG8gYmUgc2VudFxuICAgKi9cbiAgcmVhZG9ubHkgaW9Ib3N0OiBJSW9Ib3N0O1xuXG4gIC8qKlxuICAgKiBUaGUgdmVyc2lvbiBvZiB0aGUgQ0xJXG4gICAqL1xuICByZWFkb25seSBjbGlWZXJzaW9uOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTm90aWNlc1ByaW50T3B0aW9ucyB7XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gYXBwZW5kIHRoZSB0b3RhbCBudW1iZXIgb2YgdW5hY2tub3dsZWRnZWQgbm90aWNlcyB0byB0aGUgZGlzcGxheS5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IHNob3dUb3RhbD86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTm90aWNlc1JlZnJlc2hPcHRpb25zIHtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gZm9yY2UgYSBjYWNoZSByZWZyZXNoIHJlZ2FyZGxlc3Mgb2YgZXhwaXJhdGlvbiB0aW1lLlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgZm9yY2U/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBEYXRhIHNvdXJjZSBmb3IgZmV0Y2ggbm90aWNlcyBmcm9tLlxuICAgKlxuICAgKiBAZGVmYXVsdCAtIFdlYnNpdGVOb3RpY2VEYXRhU291cmNlXG4gICAqL1xuICByZWFkb25seSBkYXRhU291cmNlPzogTm90aWNlRGF0YVNvdXJjZTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBOb3RpY2VzRmlsdGVyRmlsdGVyT3B0aW9ucyB7XG4gIHJlYWRvbmx5IGRhdGE6IE5vdGljZVtdO1xuICByZWFkb25seSBjbGlWZXJzaW9uOiBzdHJpbmc7XG4gIHJlYWRvbmx5IG91dERpcjogc3RyaW5nO1xuICByZWFkb25seSBib290c3RyYXBwZWRFbnZpcm9ubWVudHM6IEJvb3RzdHJhcHBlZEVudmlyb25tZW50W107XG59XG5cbmV4cG9ydCBjbGFzcyBOb3RpY2VzRmlsdGVyIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBpb01lc3NhZ2VzOiBJb0RlZmF1bHRNZXNzYWdlcykge1xuICB9XG5cbiAgcHVibGljIGZpbHRlcihvcHRpb25zOiBOb3RpY2VzRmlsdGVyRmlsdGVyT3B0aW9ucyk6IEZpbHRlcmVkTm90aWNlW10ge1xuICAgIGNvbnN0IGNvbXBvbmVudHMgPSBbXG4gICAgICAuLi50aGlzLmNvbnN0cnVjdFRyZWVDb21wb25lbnRzKG9wdGlvbnMub3V0RGlyKSxcbiAgICAgIC4uLnRoaXMub3RoZXJDb21wb25lbnRzKG9wdGlvbnMpLFxuICAgIF07XG5cbiAgICByZXR1cm4gdGhpcy5maW5kRm9yTmFtZWRDb21wb25lbnRzKG9wdGlvbnMuZGF0YSwgY29tcG9uZW50cyk7XG4gIH1cblxuICAvKipcbiAgICogRnJvbSBhIHNldCBvZiBpbnB1dCBvcHRpb25zLCByZXR1cm4gdGhlIG5vdGljZXMgY29tcG9uZW50cyB3ZSBhcmUgc2VhcmNoaW5nIGZvclxuICAgKi9cbiAgcHJpdmF0ZSBvdGhlckNvbXBvbmVudHMob3B0aW9uczogTm90aWNlc0ZpbHRlckZpbHRlck9wdGlvbnMpOiBBY3R1YWxDb21wb25lbnRbXSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIC8vIENMSVxuICAgICAge1xuICAgICAgICBuYW1lOiAnY2xpJyxcbiAgICAgICAgdmVyc2lvbjogb3B0aW9ucy5jbGlWZXJzaW9uLFxuICAgICAgfSxcblxuICAgICAgLy8gTm9kZSB2ZXJzaW9uXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdub2RlJyxcbiAgICAgICAgdmVyc2lvbjogcHJvY2Vzcy52ZXJzaW9uLnJlcGxhY2UoL152LywgJycpLCAvLyByZW1vdmUgdGhlICd2JyBwcmVmaXguXG4gICAgICAgIGR5bmFtaWNOYW1lOiAnbm9kZScsXG4gICAgICB9LFxuXG4gICAgICAvLyBCb290c3RyYXAgZW52aXJvbm1lbnRzXG4gICAgICAuLi5vcHRpb25zLmJvb3RzdHJhcHBlZEVudmlyb25tZW50cy5mbGF0TWFwKGVudiA9PiB7XG4gICAgICAgIGNvbnN0IHNlbXZlckJvb3RzdHJhcFZlcnNpb24gPSBzZW12ZXIuY29lcmNlKGVudi5ib290c3RyYXBTdGFja1ZlcnNpb24pO1xuICAgICAgICBpZiAoIXNlbXZlckJvb3RzdHJhcFZlcnNpb24pIHtcbiAgICAgICAgICAvLyB3ZSBkb24ndCB0aHJvdyBiZWNhdXNlIG5vdGljZXMgc2hvdWxkIG5ldmVyIGNyYXNoIHRoZSBjbGkuXG4gICAgICAgICAgdGhpcy5pb01lc3NhZ2VzLndhcm5pbmcoYFdoaWxlIGZpbHRlcmluZyBub3RpY2VzLCBjb3VsZCBub3QgY29lcmNlIGJvb3RzdHJhcCB2ZXJzaW9uICcke2Vudi5ib290c3RyYXBTdGFja1ZlcnNpb259JyBpbnRvIHNlbXZlcmApO1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBbe1xuICAgICAgICAgIG5hbWU6ICdib290c3RyYXAnLFxuICAgICAgICAgIHZlcnNpb246IGAke3NlbXZlckJvb3RzdHJhcFZlcnNpb259YCxcbiAgICAgICAgICBkeW5hbWljTmFtZTogJ0VOVklST05NRU5UUycsXG4gICAgICAgICAgZHluYW1pY1ZhbHVlOiBlbnYuZW52aXJvbm1lbnQubmFtZSxcbiAgICAgICAgfV07XG4gICAgICB9KSxcbiAgICBdO1xuICB9XG5cbiAgLyoqXG4gICAqIEJhc2VkIG9uIGEgc2V0IG9mIGNvbXBvbmVudCBuYW1lcywgZmluZCBhbGwgbm90aWNlcyB0aGF0IG1hdGNoIG9uZSBvZiB0aGUgZ2l2ZW4gY29tcG9uZW50c1xuICAgKi9cbiAgcHJpdmF0ZSBmaW5kRm9yTmFtZWRDb21wb25lbnRzKGRhdGE6IE5vdGljZVtdLCBhY3R1YWxDb21wb25lbnRzOiBBY3R1YWxDb21wb25lbnRbXSk6IEZpbHRlcmVkTm90aWNlW10ge1xuICAgIHJldHVybiBkYXRhLmZsYXRNYXAobm90aWNlID0+IHtcbiAgICAgIGNvbnN0IG9ycyA9IHRoaXMucmVzb2x2ZUFsaWFzZXMobm9ybWFsaXplQ29tcG9uZW50cyhub3RpY2UuY29tcG9uZW50cykpO1xuXG4gICAgICAvLyBGaW5kIHRoZSBmaXJzdCBzZXQgb2YgdGhlIGRpc2p1bmN0aW9ucyBvZiB3aGljaCBhbGwgY29tcG9uZW50cyBtYXRjaCBhZ2FpbnN0IHRoZSBhY3R1YWwgY29tcG9uZW50cy5cbiAgICAgIC8vIFJldHVybiB0aGUgYWN0dWFsIGNvbXBvbmVudHMgd2UgZm91bmQgc28gdGhhdCB3ZSBjYW4gaW5qZWN0IHRoZWlyIGR5bmFtaWMgdmFsdWVzLiBBIHNpbmdsZSBmaWx0ZXJcbiAgICAgIC8vIGNvbXBvbmVudCBjYW4gbWF0Y2ggbW9yZSB0aGFuIG9uZSBhY3R1YWwgY29tcG9uZW50XG4gICAgICBmb3IgKGNvbnN0IGFuZHMgb2Ygb3JzKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoZWQgPSBhbmRzLm1hcChhZmZlY3RlZCA9PiBhY3R1YWxDb21wb25lbnRzLmZpbHRlcihhY3R1YWwgPT5cbiAgICAgICAgICB0aGlzLmNvbXBvbmVudE5hbWVNYXRjaGVzKGFmZmVjdGVkLCBhY3R1YWwpICYmIHNlbXZlci5zYXRpc2ZpZXMoYWN0dWFsLnZlcnNpb24sIGFmZmVjdGVkLnZlcnNpb24sIHsgaW5jbHVkZVByZXJlbGVhc2U6IHRydWUgfSkpKTtcblxuICAgICAgICAvLyBGb3IgZXZlcnkgY2xhdXNlIGluIHRoZSBmaWx0ZXIgd2UgbWF0Y2hlZCBvbmUgb3IgbW9yZSBjb21wb25lbnRzXG4gICAgICAgIGlmIChtYXRjaGVkLmV2ZXJ5KHhzID0+IHhzLmxlbmd0aCA+IDApKSB7XG4gICAgICAgICAgY29uc3QgcmV0ID0gbmV3IEZpbHRlcmVkTm90aWNlKG5vdGljZSk7XG4gICAgICAgICAgdGhpcy5hZGREeW5hbWljVmFsdWVzKG1hdGNoZWQuZmxhdE1hcCh4ID0+IHgpLCByZXQpO1xuICAgICAgICAgIHJldHVybiBbcmV0XTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gW107XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgZ2l2ZW4gXCJhZmZlY3RlZCBjb21wb25lbnRcIiBuYW1lIGFwcGxpZXMgdG8gdGhlIGdpdmVuIGFjdHVhbCBjb21wb25lbnQgbmFtZS5cbiAgICpcbiAgICogVGhlIG5hbWUgbWF0Y2hlcyBpZiB0aGUgbmFtZSBpcyBleGFjdGx5IHRoZSBzYW1lLCBvciB0aGUgbmFtZSBpbiB0aGUgbm90aWNlXG4gICAqIGlzIGEgcHJlZml4IG9mIHRoZSBub2RlIG5hbWUgd2hlbiB0aGUgcXVlcnkgZW5kcyBpbiAnLicuXG4gICAqL1xuICBwcml2YXRlIGNvbXBvbmVudE5hbWVNYXRjaGVzKHBhdHRlcm46IENvbXBvbmVudCwgYWN0dWFsOiBBY3R1YWxDb21wb25lbnQpOiBib29sZWFuIHtcbiAgICByZXR1cm4gcGF0dGVybi5uYW1lLmVuZHNXaXRoKCcuJykgPyBhY3R1YWwubmFtZS5zdGFydHNXaXRoKHBhdHRlcm4ubmFtZSkgOiBwYXR0ZXJuLm5hbWUgPT09IGFjdHVhbC5uYW1lO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgZHluYW1pYyB2YWx1ZXMgZnJvbSB0aGUgZ2l2ZW4gQWN0dWFsQ29tcG9uZW50c1xuICAgKlxuICAgKiBJZiB0aGVyZSBhcmUgbXVsdGlwbGUgY29tcG9uZW50cyB3aXRoIHRoZSBzYW1lIGR5bmFtaWMgbmFtZSwgdGhleSBhcmUgam9pbmVkXG4gICAqIGJ5IGEgY29tbWEuXG4gICAqL1xuICBwcml2YXRlIGFkZER5bmFtaWNWYWx1ZXMoY29tcHM6IEFjdHVhbENvbXBvbmVudFtdLCBub3RpY2U6IEZpbHRlcmVkTm90aWNlKSB7XG4gICAgY29uc3QgZHluYW1pY1ZhbHVlczogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+ID0ge307XG4gICAgZm9yIChjb25zdCBjb21wIG9mIGNvbXBzKSB7XG4gICAgICBpZiAoY29tcC5keW5hbWljTmFtZSkge1xuICAgICAgICBkeW5hbWljVmFsdWVzW2NvbXAuZHluYW1pY05hbWVdID0gZHluYW1pY1ZhbHVlc1tjb21wLmR5bmFtaWNOYW1lXSA/PyBbXTtcbiAgICAgICAgZHluYW1pY1ZhbHVlc1tjb21wLmR5bmFtaWNOYW1lXS5wdXNoKGNvbXAuZHluYW1pY1ZhbHVlID8/IGNvbXAudmVyc2lvbik7XG4gICAgICB9XG4gICAgfVxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVzXSBvZiBPYmplY3QuZW50cmllcyhkeW5hbWljVmFsdWVzKSkge1xuICAgICAgbm90aWNlLmFkZER5bmFtaWNWYWx1ZShrZXksIHZhbHVlcy5qb2luKCcsJykpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUcmVhdCAnZnJhbWV3b3JrJyBhcyBhbiBhbGlhcyBmb3IgZWl0aGVyIGBhd3MtY2RrLWxpYi5gIG9yIGBAYXdzLWNkay9jb3JlLmAuXG4gICAqXG4gICAqIEJlY2F1c2UgaXQncyBFSVRIRVIgYGF3cy1jZGstbGliYCBvciBgQGF3cy1jZGsvY29yZWAsIHdlIG5lZWQgdG8gYWRkIG11bHRpcGxlXG4gICAqIGFycmF5cyBhdCB0aGUgdG9wIGxldmVsLlxuICAgKi9cbiAgcHJpdmF0ZSByZXNvbHZlQWxpYXNlcyhvcnM6IENvbXBvbmVudFtdW10pOiBDb21wb25lbnRbXVtdIHtcbiAgICByZXR1cm4gb3JzLmZsYXRNYXAoYW5kcyA9PiB7XG4gICAgICBjb25zdCBoYXNGcmFtZXdvcmsgPSBhbmRzLmZpbmQoYyA9PiBjLm5hbWUgPT09ICdmcmFtZXdvcmsnKTtcbiAgICAgIGlmICghaGFzRnJhbWV3b3JrKSB7XG4gICAgICAgIHJldHVybiBbYW5kc107XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBbXG4gICAgICAgIGFuZHMubWFwKGMgPT4gYy5uYW1lID09PSAnZnJhbWV3b3JrJyA/IHsgLi4uYywgbmFtZTogJ0Bhd3MtY2RrL2NvcmUuJyB9IDogYyksXG4gICAgICAgIGFuZHMubWFwKGMgPT4gYy5uYW1lID09PSAnZnJhbWV3b3JrJyA/IHsgLi4uYywgbmFtZTogJ2F3cy1jZGstbGliLicgfSA6IGMpLFxuICAgICAgXTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkIHRoZSBjb25zdHJ1Y3QgdHJlZSBmcm9tIHRoZSBnaXZlbiBkaXJlY3RvcnkgYW5kIHJldHVybiBpdHMgY29tcG9uZW50c1xuICAgKi9cbiAgcHJpdmF0ZSBjb25zdHJ1Y3RUcmVlQ29tcG9uZW50cyhtYW5pZmVzdERpcjogc3RyaW5nKTogQWN0dWFsQ29tcG9uZW50W10ge1xuICAgIGNvbnN0IHRyZWUgPSBsb2FkVHJlZUZyb21EaXIobWFuaWZlc3REaXIsIChtc2c6IHN0cmluZykgPT4gdm9pZCB0aGlzLmlvTWVzc2FnZXMubm90aWZ5KElPLkRFRkFVTFRfQVNTRU1CTFlfVFJBQ0UubXNnKG1zZykpKTtcbiAgICBpZiAoIXRyZWUpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCByZXQ6IEFjdHVhbENvbXBvbmVudFtdID0gW107XG4gICAgcmVjdXJzZSh0cmVlKTtcbiAgICByZXR1cm4gcmV0O1xuXG4gICAgZnVuY3Rpb24gcmVjdXJzZSh4OiBDb25zdHJ1Y3RUcmVlTm9kZSkge1xuICAgICAgaWYgKHguY29uc3RydWN0SW5mbz8uZnFuICYmIHguY29uc3RydWN0SW5mbz8udmVyc2lvbikge1xuICAgICAgICByZXQucHVzaCh7XG4gICAgICAgICAgbmFtZTogeC5jb25zdHJ1Y3RJbmZvPy5mcW4sXG4gICAgICAgICAgdmVyc2lvbjogeC5jb25zdHJ1Y3RJbmZvPy52ZXJzaW9uLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBPYmplY3QudmFsdWVzKHguY2hpbGRyZW4gPz8ge30pKSB7XG4gICAgICAgIHJlY3Vyc2UoY2hpbGQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5pbnRlcmZhY2UgQWN0dWFsQ29tcG9uZW50IHtcbiAgLyoqXG4gICAqIE5hbWUgb2YgdGhlIGNvbXBvbmVudFxuICAgKi9cbiAgcmVhZG9ubHkgbmFtZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBWZXJzaW9uIG9mIHRoZSBjb21wb25lbnRcbiAgICovXG4gIHJlYWRvbmx5IHZlcnNpb246IHN0cmluZztcblxuICAvKipcbiAgICogSWYgbWF0Y2hlZCwgdW5kZXIgd2hhdCBuYW1lIHNob3VsZCBpdCBiZSBhZGRlZCB0byB0aGUgc2V0IG9mIGR5bmFtaWMgdmFsdWVzXG4gICAqXG4gICAqIFRoZXNlIHdpbGwgYmUgdXNlZCB0byBzdWJzdGl0dXRlIHBsYWNlaG9sZGVycyBpbiB0aGUgbWVzc2FnZSBzdHJpbmcsIHdoZXJlXG4gICAqIHBsYWNlaG9sZGVycyBsb29rIGxpa2UgYHtyZXNvbHZlOlhZWn1gLlxuICAgKlxuICAgKiBJZiB0aGVyZSBpcyBtb3JlIHRoYW4gb25lIGNvbXBvbmVudCB3aXRoIHRoZSBzYW1lIGR5bmFtaWMgbmFtZSwgdGhleSBhcmVcbiAgICogam9pbmVkIGJ5ICcsJy5cbiAgICpcbiAgICogQGRlZmF1bHQgLSBEb24ndCBhZGQgdG8gdGhlIHNldCBvZiBkeW5hbWljIHZhbHVlcy5cbiAgICovXG4gIHJlYWRvbmx5IGR5bmFtaWNOYW1lPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBJZiBtYXRjaGVkLCB3aGF0IHdlIHNob3VsZCBwdXQgaW4gdGhlIHNldCBvZiBkeW5hbWljIHZhbHVlcyBpbnNzdGVhZCBvZiB0aGUgdmVyc2lvbi5cbiAgICpcbiAgICogT25seSB1c2VkIGlmIGBkeW5hbWljTmFtZWAgaXMgc2V0OyBieSBkZWZhdWx0IHdlIHdpbGwgYWRkIHRoZSBhY3R1YWwgdmVyc2lvblxuICAgKiBvZiB0aGUgY29tcG9uZW50LlxuICAgKlxuICAgKiBAZGVmYXVsdCAtIFRoZSB2ZXJzaW9uLlxuICAgKi9cbiAgcmVhZG9ubHkgZHluYW1pY1ZhbHVlPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIEluZm9ybWF0aW9uIGFib3V0IGEgYm9vdHN0cmFwcGVkIGVudmlyb25tZW50LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEJvb3RzdHJhcHBlZEVudmlyb25tZW50IHtcbiAgcmVhZG9ubHkgYm9vdHN0cmFwU3RhY2tWZXJzaW9uOiBudW1iZXI7XG4gIHJlYWRvbmx5IGVudmlyb25tZW50OiBFbnZpcm9ubWVudDtcbn1cblxuLyoqXG4gKiBQcm92aWRlcyBhY2Nlc3MgdG8gbm90aWNlcyB0aGUgQ0xJIGNhbiBkaXNwbGF5LlxuICovXG5leHBvcnQgY2xhc3MgTm90aWNlcyB7XG4gIC8qKlxuICAgKiBDcmVhdGUgYW4gaW5zdGFuY2UuIE5vdGUgdGhhdCB0aGlzIHJlcGxhY2VzIHRoZSBzaW5nbGV0b24uXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGNyZWF0ZShwcm9wczogTm90aWNlc1Byb3BzKTogTm90aWNlcyB7XG4gICAgdGhpcy5faW5zdGFuY2UgPSBuZXcgTm90aWNlcyhwcm9wcyk7XG4gICAgcmV0dXJuIHRoaXMuX2luc3RhbmNlO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgc2luZ2xldG9uIGluc3RhbmNlLiBNYXkgcmV0dXJuIGB1bmRlZmluZWRgIGlmIGBjcmVhdGVgIGhhcyBub3QgYmVlbiBjYWxsZWQuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGdldCgpOiBOb3RpY2VzIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5faW5zdGFuY2U7XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyBfaW5zdGFuY2U6IE5vdGljZXMgfCB1bmRlZmluZWQ7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBjb250ZXh0OiBDb250ZXh0O1xuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dDogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IGFja25vd2xlZGdlZElzc3VlTnVtYmVyczogU2V0PE51bWJlcj47XG4gIHByaXZhdGUgcmVhZG9ubHkgaW5jbHVkZUFja25vd2xlZ2RlZDogYm9vbGVhbjtcbiAgcHJpdmF0ZSByZWFkb25seSBodHRwT3B0aW9uczogU2RrSHR0cE9wdGlvbnM7XG4gIHByaXZhdGUgcmVhZG9ubHkgaW9IZWxwZXI6IElvSGVscGVyO1xuICBwcml2YXRlIHJlYWRvbmx5IGlvTWVzc2FnZXM6IElvRGVmYXVsdE1lc3NhZ2VzO1xuICBwcml2YXRlIHJlYWRvbmx5IGNsaVZlcnNpb246IHN0cmluZztcblxuICBwcml2YXRlIGRhdGE6IFNldDxOb3RpY2U+ID0gbmV3IFNldCgpO1xuXG4gIC8vIHNldHMgZG9uJ3QgZGVkdXBsaWNhdGUgaW50ZXJmYWNlcywgc28gd2UgdXNlIGEgbWFwLlxuICBwcml2YXRlIHJlYWRvbmx5IGJvb3RzdHJhcHBlZEVudmlyb25tZW50czogTWFwPHN0cmluZywgQm9vdHN0cmFwcGVkRW52aXJvbm1lbnQ+ID0gbmV3IE1hcCgpO1xuXG4gIHByaXZhdGUgY29uc3RydWN0b3IocHJvcHM6IE5vdGljZXNQcm9wcykge1xuICAgIHRoaXMuY29udGV4dCA9IHByb3BzLmNvbnRleHQ7XG4gICAgdGhpcy5hY2tub3dsZWRnZWRJc3N1ZU51bWJlcnMgPSBuZXcgU2V0KHRoaXMuY29udGV4dC5nZXQoJ2Fja25vd2xlZGdlZC1pc3N1ZS1udW1iZXJzJykgPz8gW10pO1xuICAgIHRoaXMuaW5jbHVkZUFja25vd2xlZ2RlZCA9IHByb3BzLmluY2x1ZGVBY2tub3dsZWRnZWQgPz8gZmFsc2U7XG4gICAgdGhpcy5vdXRwdXQgPSBwcm9wcy5vdXRwdXQgPz8gJ2Nkay5vdXQnO1xuICAgIHRoaXMuaHR0cE9wdGlvbnMgPSBwcm9wcy5odHRwT3B0aW9ucyA/PyB7fTtcbiAgICB0aGlzLmlvSGVscGVyID0gYXNJb0hlbHBlcihwcm9wcy5pb0hvc3QsICdub3RpY2VzJyBhcyBhbnkgLyogZm9yY2luZyBhIENsaUFjdGlvbiB0byBhIFRvb2xraXRBY3Rpb24gKi8pO1xuICAgIHRoaXMuaW9NZXNzYWdlcyA9IG5ldyBJb0RlZmF1bHRNZXNzYWdlcyh0aGlzLmlvSGVscGVyKTtcbiAgICB0aGlzLmNsaVZlcnNpb24gPSBwcm9wcy5jbGlWZXJzaW9uO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBhIGJvb3RzdHJhcCBpbmZvcm1hdGlvbiB0byBmaWx0ZXIgb24uIENhbiBoYXZlIG11bHRpcGxlIHZhbHVlc1xuICAgKiBpbiBjYXNlIG9mIG11bHRpLWVudmlyb25tZW50IGRlcGxveW1lbnRzLlxuICAgKi9cbiAgcHVibGljIGFkZEJvb3RzdHJhcHBlZEVudmlyb25tZW50KGJvb3RzdHJhcHBlZDogQm9vdHN0cmFwcGVkRW52aXJvbm1lbnQpIHtcbiAgICBjb25zdCBrZXkgPSBbXG4gICAgICBib290c3RyYXBwZWQuYm9vdHN0cmFwU3RhY2tWZXJzaW9uLFxuICAgICAgYm9vdHN0cmFwcGVkLmVudmlyb25tZW50LmFjY291bnQsXG4gICAgICBib290c3RyYXBwZWQuZW52aXJvbm1lbnQucmVnaW9uLFxuICAgICAgYm9vdHN0cmFwcGVkLmVudmlyb25tZW50Lm5hbWUsXG4gICAgXS5qb2luKCc6Jyk7XG4gICAgdGhpcy5ib290c3RyYXBwZWRFbnZpcm9ubWVudHMuc2V0KGtleSwgYm9vdHN0cmFwcGVkKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWZyZXNoIHRoZSBsaXN0IG9mIG5vdGljZXMgdGhpcyBpbnN0YW5jZSBpcyBhd2FyZSBvZi5cbiAgICogVG8gbWFrZSBzdXJlIHRoaXMgbmV2ZXIgY3Jhc2hlcyB0aGUgQ0xJIHByb2Nlc3MsIGFsbCBmYWlsdXJlcyBhcmUgY2F1Z2h0IGFuZFxuICAgKiBzaWxlbnRseSBsb2dnZWQuXG4gICAqXG4gICAqIElmIGNvbnRleHQgaXMgY29uZmlndXJlZCB0byBub3QgZGlzcGxheSBub3RpY2VzLCB0aGlzIHdpbGwgbm8tb3AuXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgcmVmcmVzaChvcHRpb25zOiBOb3RpY2VzUmVmcmVzaE9wdGlvbnMgPSB7fSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB1bmRlcmx5aW5nRGF0YVNvdXJjZSA9IG9wdGlvbnMuZGF0YVNvdXJjZSA/PyBuZXcgV2Vic2l0ZU5vdGljZURhdGFTb3VyY2UodGhpcy5pb0hlbHBlciwgdGhpcy5odHRwT3B0aW9ucyk7XG4gICAgICBjb25zdCBkYXRhU291cmNlID0gbmV3IENhY2hlZERhdGFTb3VyY2UodGhpcy5pb01lc3NhZ2VzLCBDQUNIRV9GSUxFX1BBVEgsIHVuZGVybHlpbmdEYXRhU291cmNlLCBvcHRpb25zLmZvcmNlID8/IGZhbHNlKTtcbiAgICAgIGNvbnN0IG5vdGljZXMgPSBhd2FpdCBkYXRhU291cmNlLmZldGNoKCk7XG4gICAgICB0aGlzLmRhdGEgPSBuZXcgU2V0KHRoaXMuaW5jbHVkZUFja25vd2xlZ2RlZCA/IG5vdGljZXMgOiBub3RpY2VzLmZpbHRlcihuID0+ICF0aGlzLmFja25vd2xlZGdlZElzc3VlTnVtYmVycy5oYXMobi5pc3N1ZU51bWJlcikpKTtcbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIHRoaXMuaW9NZXNzYWdlcy5kZWJ1ZyhgQ291bGQgbm90IHJlZnJlc2ggbm90aWNlczogJHtlfWApO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNwbGF5IHRoZSByZWxldmFudCBub3RpY2VzICh1bmxlc3MgY29udGV4dCBkaWN0YXRlcyB3ZSBzaG91bGRuJ3QpLlxuICAgKi9cbiAgcHVibGljIGRpc3BsYXkob3B0aW9uczogTm90aWNlc1ByaW50T3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgZmlsdGVyZWROb3RpY2VzID0gbmV3IE5vdGljZXNGaWx0ZXIodGhpcy5pb01lc3NhZ2VzKS5maWx0ZXIoe1xuICAgICAgZGF0YTogQXJyYXkuZnJvbSh0aGlzLmRhdGEpLFxuICAgICAgY2xpVmVyc2lvbjogdGhpcy5jbGlWZXJzaW9uLFxuICAgICAgb3V0RGlyOiB0aGlzLm91dHB1dCxcbiAgICAgIGJvb3RzdHJhcHBlZEVudmlyb25tZW50czogQXJyYXkuZnJvbSh0aGlzLmJvb3RzdHJhcHBlZEVudmlyb25tZW50cy52YWx1ZXMoKSksXG4gICAgfSk7XG5cbiAgICBpZiAoZmlsdGVyZWROb3RpY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgIHZvaWQgdGhpcy5pb01lc3NhZ2VzLm5vdGlmeShJTy5DREtfVE9PTEtJVF9JMDEwMC5tc2coW1xuICAgICAgICAnJyxcbiAgICAgICAgJ05PVElDRVMgICAgICAgICAoV2hhdFxcJ3MgdGhpcz8gaHR0cHM6Ly9naXRodWIuY29tL2F3cy9hd3MtY2RrL3dpa2kvQ0xJLU5vdGljZXMpJyxcbiAgICAgICAgJycsXG4gICAgICBdLmpvaW4oJ1xcbicpKSk7XG4gICAgICBmb3IgKGNvbnN0IGZpbHRlcmVkIG9mIGZpbHRlcmVkTm90aWNlcykge1xuICAgICAgICBjb25zdCBmb3JtYXR0ZWQgPSBmaWx0ZXJlZC5mb3JtYXQoKSArICdcXG4nO1xuICAgICAgICBzd2l0Y2ggKGZpbHRlcmVkLm5vdGljZS5zZXZlcml0eSkge1xuICAgICAgICAgIGNhc2UgJ3dhcm5pbmcnOlxuICAgICAgICAgICAgdm9pZCB0aGlzLmlvTWVzc2FnZXMubm90aWZ5KElPLkNES19UT09MS0lUX1cwMTAxLm1zZyhmb3JtYXR0ZWQpKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ2Vycm9yJzpcbiAgICAgICAgICAgIHZvaWQgdGhpcy5pb01lc3NhZ2VzLm5vdGlmeShJTy5DREtfVE9PTEtJVF9FMDEwMS5tc2coZm9ybWF0dGVkKSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgdm9pZCB0aGlzLmlvTWVzc2FnZXMubm90aWZ5KElPLkNES19UT09MS0lUX0kwMTAxLm1zZyhmb3JtYXR0ZWQpKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB2b2lkIHRoaXMuaW9NZXNzYWdlcy5ub3RpZnkoSU8uQ0RLX1RPT0xLSVRfSTAxMDAubXNnKFxuICAgICAgICBgSWYgeW91IGRvbuKAmXQgd2FudCB0byBzZWUgYSBub3RpY2UgYW55bW9yZSwgdXNlIFwiY2RrIGFja25vd2xlZGdlIDxpZD5cIi4gRm9yIGV4YW1wbGUsIFwiY2RrIGFja25vd2xlZGdlICR7ZmlsdGVyZWROb3RpY2VzWzBdLm5vdGljZS5pc3N1ZU51bWJlcn1cIi5gLFxuICAgICAgKSk7XG4gICAgfVxuXG4gICAgaWYgKG9wdGlvbnMuc2hvd1RvdGFsID8/IGZhbHNlKSB7XG4gICAgICB2b2lkIHRoaXMuaW9NZXNzYWdlcy5ub3RpZnkoSU8uQ0RLX1RPT0xLSVRfSTAxMDAubXNnKFxuICAgICAgICBgXFxuVGhlcmUgYXJlICR7ZmlsdGVyZWROb3RpY2VzLmxlbmd0aH0gdW5hY2tub3dsZWRnZWQgbm90aWNlKHMpLmAsXG4gICAgICApKTtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBDb21wb25lbnQge1xuICBuYW1lOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSByYW5nZSBvZiBhZmZlY3RlZCB2ZXJzaW9uc1xuICAgKi9cbiAgdmVyc2lvbjogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE5vdGljZSB7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIGlzc3VlTnVtYmVyOiBudW1iZXI7XG4gIG92ZXJ2aWV3OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBBIHNldCBvZiBhZmZlY3RlZCBjb21wb25lbnRzXG4gICAqXG4gICAqIFRoZSBjYW5vbmljYWwgZm9ybSBvZiBhIGxpc3Qgb2YgY29tcG9uZW50cyBpcyBpbiBEaXNqdW5jdGl2ZSBOb3JtYWwgRm9ybVxuICAgKiAoaS5lLiwgYW4gT1Igb2YgQU5EcykuIFRoaXMgaXMgdGhlIGZvcm0gd2hlbiB0aGUgbGlzdCBvZiBjb21wb25lbnRzIGlzIGFcbiAgICogZG91Ymx5IG5lc3RlZCBhcnJheTogdGhlIG5vdGljZSBtYXRjaGVzIGlmIGFsbCBjb21wb25lbnRzIG9mIGF0IGxlYXN0IG9uZVxuICAgKiBvZiB0aGUgdG9wLWxldmVsIGFycmF5IG1hdGNoZXMuXG4gICAqXG4gICAqIElmIHRoZSBgY29tcG9uZW50c2AgaXMgYSBzaW5nbGUtbGV2ZWwgYXJyYXksIGl0IGlzIGV2YWx1YXRlZCBhcyBhbiBPUjsgaXRcbiAgICogbWF0Y2hlcyBpZiBhbnkgb2YgdGhlIGNvbXBvbmVudHMgbWF0Y2hlcy5cbiAgICovXG4gIGNvbXBvbmVudHM6IEFycmF5PENvbXBvbmVudCB8IENvbXBvbmVudFtdPjtcbiAgc2NoZW1hVmVyc2lvbjogc3RyaW5nO1xuICBzZXZlcml0eT86IHN0cmluZztcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIHRoZSBnaXZlbiBjb21wb25lbnRzIHN0cnVjdHVyZSBpbnRvIERORiBmb3JtXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUNvbXBvbmVudHMoeHM6IEFycmF5PENvbXBvbmVudCB8IENvbXBvbmVudFtdPik6IENvbXBvbmVudFtdW10ge1xuICByZXR1cm4geHMubWFwKHggPT4gQXJyYXkuaXNBcnJheSh4KSA/IHggOiBbeF0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJDb25qdW5jdGlvbih4czogQ29tcG9uZW50W10pOiBzdHJpbmcge1xuICByZXR1cm4geHMubWFwKGMgPT4gYCR7Yy5uYW1lfTogJHtjLnZlcnNpb259YCkuam9pbignIEFORCAnKTtcbn1cblxuLyoqXG4gKiBOb3RpY2UgYWZ0ZXIgcGFzc2luZyB0aGUgZmlsdGVyLiBBIGZpbHRlciBjYW4gYXVnbWVudCBhIG5vdGljZSB3aXRoXG4gKiBkeW5hbWljIHZhbHVlcyBhcyBpdCBoYXMgYWNjZXNzIHRvIHRoZSBkeW5hbWljIG1hdGNoaW5nIGRhdGEuXG4gKi9cbmV4cG9ydCBjbGFzcyBGaWx0ZXJlZE5vdGljZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgZHluYW1pY1ZhbHVlczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSA9IHt9O1xuXG4gIHB1YmxpYyBjb25zdHJ1Y3RvcihwdWJsaWMgcmVhZG9ubHkgbm90aWNlOiBOb3RpY2UpIHtcbiAgfVxuXG4gIHB1YmxpYyBhZGREeW5hbWljVmFsdWUoa2V5OiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpIHtcbiAgICB0aGlzLmR5bmFtaWNWYWx1ZXNbYHtyZXNvbHZlOiR7a2V5fX1gXSA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGZvcm1hdCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IGNvbXBvbmVudHNWYWx1ZSA9IG5vcm1hbGl6ZUNvbXBvbmVudHModGhpcy5ub3RpY2UuY29tcG9uZW50cykubWFwKHJlbmRlckNvbmp1bmN0aW9uKS5qb2luKCcsICcpO1xuICAgIHJldHVybiB0aGlzLnJlc29sdmVEeW5hbWljVmFsdWVzKFtcbiAgICAgIGAke3RoaXMubm90aWNlLmlzc3VlTnVtYmVyfVxcdCR7dGhpcy5ub3RpY2UudGl0bGV9YCxcbiAgICAgIHRoaXMuZm9ybWF0T3ZlcnZpZXcoKSxcbiAgICAgIGBcXHRBZmZlY3RlZCB2ZXJzaW9uczogJHtjb21wb25lbnRzVmFsdWV9YCxcbiAgICAgIGBcXHRNb3JlIGluZm9ybWF0aW9uIGF0OiBodHRwczovL2dpdGh1Yi5jb20vYXdzL2F3cy1jZGsvaXNzdWVzLyR7dGhpcy5ub3RpY2UuaXNzdWVOdW1iZXJ9YCxcbiAgICBdLmpvaW4oJ1xcblxcbicpICsgJ1xcbicpO1xuICB9XG5cbiAgcHJpdmF0ZSBmb3JtYXRPdmVydmlldygpIHtcbiAgICBjb25zdCB3cmFwID0gKHM6IHN0cmluZykgPT4gcy5yZXBsYWNlKC8oPyFbXlxcbl17MSw2MH0kKShbXlxcbl17MSw2MH0pXFxzL2csICckMVxcbicpO1xuXG4gICAgY29uc3QgaGVhZGluZyA9ICdPdmVydmlldzogJztcbiAgICBjb25zdCBzZXBhcmF0b3IgPSBgXFxuXFx0JHsnICcucmVwZWF0KGhlYWRpbmcubGVuZ3RoKX1gO1xuICAgIGNvbnN0IGNvbnRlbnQgPSB3cmFwKHRoaXMubm90aWNlLm92ZXJ2aWV3KVxuICAgICAgLnNwbGl0KCdcXG4nKVxuICAgICAgLmpvaW4oc2VwYXJhdG9yKTtcblxuICAgIHJldHVybiAnXFx0JyArIGhlYWRpbmcgKyBjb250ZW50O1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlRHluYW1pY1ZhbHVlcyhpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBwYXR0ZXJuID0gbmV3IFJlZ0V4cChPYmplY3Qua2V5cyh0aGlzLmR5bmFtaWNWYWx1ZXMpLmpvaW4oJ3wnKSwgJ2cnKTtcbiAgICByZXR1cm4gaW5wdXQucmVwbGFjZShwYXR0ZXJuLCAobWF0Y2hlZCkgPT4gdGhpcy5keW5hbWljVmFsdWVzW21hdGNoZWRdID8/IG1hdGNoZWQpO1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTm90aWNlRGF0YVNvdXJjZSB7XG4gIGZldGNoKCk6IFByb21pc2U8Tm90aWNlW10+O1xufVxuXG5leHBvcnQgY2xhc3MgV2Vic2l0ZU5vdGljZURhdGFTb3VyY2UgaW1wbGVtZW50cyBOb3RpY2VEYXRhU291cmNlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiBTZGtIdHRwT3B0aW9ucztcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGlvSGVscGVyOiBJb0hlbHBlciwgb3B0aW9uczogU2RrSHR0cE9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gIH1cblxuICBhc3luYyBmZXRjaCgpOiBQcm9taXNlPE5vdGljZVtdPiB7XG4gICAgY29uc3QgdGltZW91dCA9IDMwMDA7XG5cbiAgICBjb25zdCBvcHRpb25zOiBSZXF1ZXN0T3B0aW9ucyA9IHtcbiAgICAgIGFnZW50OiBhd2FpdCBuZXcgUHJveHlBZ2VudFByb3ZpZGVyKHRoaXMuaW9IZWxwZXIpLmNyZWF0ZSh0aGlzLm9wdGlvbnMpLFxuICAgIH07XG5cbiAgICBjb25zdCBub3RpY2VzID0gYXdhaXQgbmV3IFByb21pc2U8Tm90aWNlW10+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGxldCByZXE6IENsaWVudFJlcXVlc3QgfCB1bmRlZmluZWQ7XG5cbiAgICAgIGxldCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBpZiAocmVxKSB7XG4gICAgICAgICAgcmVxLmRlc3Ryb3kobmV3IFRvb2xraXRFcnJvcignUmVxdWVzdCB0aW1lZCBvdXQnKSk7XG4gICAgICAgIH1cbiAgICAgIH0sIHRpbWVvdXQpO1xuXG4gICAgICB0aW1lci51bnJlZigpO1xuXG4gICAgICB0cnkge1xuICAgICAgICByZXEgPSBodHRwcy5nZXQoJ2h0dHBzOi8vY2xpLmNkay5kZXYtdG9vbHMuYXdzLmRldi9ub3RpY2VzLmpzb24nLFxuICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgcmVzID0+IHtcbiAgICAgICAgICAgIGlmIChyZXMuc3RhdHVzQ29kZSA9PT0gMjAwKSB7XG4gICAgICAgICAgICAgIHJlcy5zZXRFbmNvZGluZygndXRmOCcpO1xuICAgICAgICAgICAgICBsZXQgcmF3RGF0YSA9ICcnO1xuICAgICAgICAgICAgICByZXMub24oJ2RhdGEnLCAoY2h1bmspID0+IHtcbiAgICAgICAgICAgICAgICByYXdEYXRhICs9IGNodW5rO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgcmVzLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKHJhd0RhdGEpLm5vdGljZXMgYXMgTm90aWNlW107XG4gICAgICAgICAgICAgICAgICBpZiAoIWRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihcIidub3RpY2VzJyBrZXkgaXMgbWlzc2luZ1wiKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIHJlc29sdmUoZGF0YSA/PyBbXSk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgICAgICAgICAgICByZWplY3QobmV3IFRvb2xraXRFcnJvcihgRmFpbGVkIHRvIHBhcnNlIG5vdGljZXM6ICR7Zm9ybWF0RXJyb3JNZXNzYWdlKGUpfWApKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICByZXMub24oJ2Vycm9yJywgZSA9PiB7XG4gICAgICAgICAgICAgICAgcmVqZWN0KG5ldyBUb29sa2l0RXJyb3IoYEZhaWxlZCB0byBmZXRjaCBub3RpY2VzOiAke2Zvcm1hdEVycm9yTWVzc2FnZShlKX1gKSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcmVqZWN0KG5ldyBUb29sa2l0RXJyb3IoYEZhaWxlZCB0byBmZXRjaCBub3RpY2VzLiBTdGF0dXMgY29kZTogJHtyZXMuc3RhdHVzQ29kZX1gKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIHJlcS5vbignZXJyb3InLCByZWplY3QpO1xuICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgIHJlamVjdChuZXcgVG9vbGtpdEVycm9yKGBIVFRQUyAnZ2V0JyBjYWxsIHRocmV3IGFuIGVycm9yOiAke2Zvcm1hdEVycm9yTWVzc2FnZShlKX1gKSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKCdOb3RpY2VzIHJlZnJlc2hlZCcpKTtcbiAgICByZXR1cm4gbm90aWNlcztcbiAgfVxufVxuXG5pbnRlcmZhY2UgQ2FjaGVkTm90aWNlcyB7XG4gIGV4cGlyYXRpb246IG51bWJlcjtcbiAgbm90aWNlczogTm90aWNlW107XG59XG5cbmNvbnN0IFRJTUVfVE9fTElWRV9TVUNDRVNTID0gNjAgKiA2MCAqIDEwMDA7IC8vIDEgaG91clxuY29uc3QgVElNRV9UT19MSVZFX0VSUk9SID0gMSAqIDYwICogMTAwMDsgLy8gMSBtaW51dGVcblxuZXhwb3J0IGNsYXNzIENhY2hlZERhdGFTb3VyY2UgaW1wbGVtZW50cyBOb3RpY2VEYXRhU291cmNlIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBpb01lc3NhZ2VzOiBJb0RlZmF1bHRNZXNzYWdlcyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGZpbGVOYW1lOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBkYXRhU291cmNlOiBOb3RpY2VEYXRhU291cmNlLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgc2tpcENhY2hlPzogYm9vbGVhbikge1xuICB9XG5cbiAgYXN5bmMgZmV0Y2goKTogUHJvbWlzZTxOb3RpY2VbXT4ge1xuICAgIGNvbnN0IGNhY2hlZERhdGEgPSBhd2FpdCB0aGlzLmxvYWQoKTtcbiAgICBjb25zdCBkYXRhID0gY2FjaGVkRGF0YS5ub3RpY2VzO1xuICAgIGNvbnN0IGV4cGlyYXRpb24gPSBjYWNoZWREYXRhLmV4cGlyYXRpb24gPz8gMDtcblxuICAgIGlmIChEYXRlLm5vdygpID4gZXhwaXJhdGlvbiB8fCB0aGlzLnNraXBDYWNoZSkge1xuICAgICAgY29uc3QgZnJlc2hEYXRhID0gYXdhaXQgdGhpcy5mZXRjaElubmVyKCk7XG4gICAgICBhd2FpdCB0aGlzLnNhdmUoZnJlc2hEYXRhKTtcbiAgICAgIHJldHVybiBmcmVzaERhdGEubm90aWNlcztcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5pb01lc3NhZ2VzLmRlYnVnKGBSZWFkaW5nIGNhY2hlZCBub3RpY2VzIGZyb20gJHt0aGlzLmZpbGVOYW1lfWApO1xuICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmZXRjaElubmVyKCk6IFByb21pc2U8Q2FjaGVkTm90aWNlcz4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBleHBpcmF0aW9uOiBEYXRlLm5vdygpICsgVElNRV9UT19MSVZFX1NVQ0NFU1MsXG4gICAgICAgIG5vdGljZXM6IGF3YWl0IHRoaXMuZGF0YVNvdXJjZS5mZXRjaCgpLFxuICAgICAgfTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aGlzLmlvTWVzc2FnZXMuZGVidWcoYENvdWxkIG5vdCByZWZyZXNoIG5vdGljZXM6ICR7ZX1gKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGV4cGlyYXRpb246IERhdGUubm93KCkgKyBUSU1FX1RPX0xJVkVfRVJST1IsXG4gICAgICAgIG5vdGljZXM6IFtdLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGxvYWQoKTogUHJvbWlzZTxDYWNoZWROb3RpY2VzPiB7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0ge1xuICAgICAgZXhwaXJhdGlvbjogMCxcbiAgICAgIG5vdGljZXM6IFtdLFxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGZzLmV4aXN0c1N5bmModGhpcy5maWxlTmFtZSlcbiAgICAgICAgPyBhd2FpdCBmcy5yZWFkSlNPTih0aGlzLmZpbGVOYW1lKSBhcyBDYWNoZWROb3RpY2VzXG4gICAgICAgIDogZGVmYXVsdFZhbHVlO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRoaXMuaW9NZXNzYWdlcy5kZWJ1ZyhgRmFpbGVkIHRvIGxvYWQgbm90aWNlcyBmcm9tIGNhY2hlOiAke2V9YCk7XG4gICAgICByZXR1cm4gZGVmYXVsdFZhbHVlO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2F2ZShjYWNoZWQ6IENhY2hlZE5vdGljZXMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZnMud3JpdGVKU09OKHRoaXMuZmlsZU5hbWUsIGNhY2hlZCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5pb01lc3NhZ2VzLmRlYnVnKGBGYWlsZWQgdG8gc3RvcmUgbm90aWNlcyBpbiB0aGUgY2FjaGU6ICR7ZX1gKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==