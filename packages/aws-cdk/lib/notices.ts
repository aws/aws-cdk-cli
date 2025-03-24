import type { ClientRequest } from 'http';
import type { RequestOptions } from 'https';
import * as https from 'node:https';
import * as path from 'path';
import type { Environment } from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import * as semver from 'semver';
import type { SdkHttpOptions } from './api';
import { AwsCliCompatible } from './api/aws-auth/awscli-compatible';
import type { Context } from './api/context';
import type { IIoHost } from './cli/io-host';
import { versionNumber } from './cli/version';
import type { ConstructTreeNode } from './api/tree';
import { loadTreeFromDir } from './api/tree';
import { cdkCacheDir, formatErrorMessage } from './util';
import { ToolkitError } from '../../@aws-cdk/tmp-toolkit-helpers/src/api';
import { IO, asIoHelper, IoDefaultMessages } from '../../@aws-cdk/tmp-toolkit-helpers/src/api/io/private';

const CACHE_FILE_PATH = path.join(cdkCacheDir(), 'notices.json');

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

export class NoticesFilter {
  constructor(private readonly ioMessages: IoDefaultMessages) {
  }

  public filter(options: NoticesFilterFilterOptions): FilteredNotice[] {
    const components = [
      ...this.constructTreeComponents(options.outDir),
      ...this.otherComponents(options),
    ];

    return this.findForNamedComponents(options.data, components);
  }

  /**
   * From a set of input options, return the notices components we are searching for
   */
  private otherComponents(options: NoticesFilterFilterOptions): ActualComponent[] {
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
  private findForNamedComponents(data: Notice[], actualComponents: ActualComponent[]): FilteredNotice[] {
    return data.flatMap(notice => {
      const ors = this.resolveAliases(normalizeComponents(notice.components));

      // Find the first set of the disjunctions of which all components match against the actual components.
      // Return the actual components we found so that we can inject their dynamic values. A single filter
      // component can match more than one actual component
      for (const ands of ors) {
        const matched = ands.map(affected => actualComponents.filter(actual =>
          this.componentNameMatches(affected, actual) && semver.satisfies(actual.version, affected.version, { includePrerelease: true })));

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
  private componentNameMatches(pattern: Component, actual: ActualComponent): boolean {
    return pattern.name.endsWith('.') ? actual.name.startsWith(pattern.name) : pattern.name === actual.name;
  }

  /**
   * Adds dynamic values from the given ActualComponents
   *
   * If there are multiple components with the same dynamic name, they are joined
   * by a comma.
   */
  private addDynamicValues(comps: ActualComponent[], notice: FilteredNotice) {
    const dynamicValues: Record<string, string[]> = {};
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
  private resolveAliases(ors: Component[][]): Component[][] {
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
  private constructTreeComponents(manifestDir: string): ActualComponent[] {
    const tree = loadTreeFromDir(manifestDir, (msg: string) => void this.ioMessages.notify(IO.DEFAULT_ASSEMBLY_TRACE.msg(msg)));
    if (!tree) {
      return [];
    }

    const ret: ActualComponent[] = [];
    recurse(tree);
    return ret;

    function recurse(x: ConstructTreeNode) {
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

interface ActualComponent {
  /**
   * Name of the component
   */
  readonly name: string;

  /**
   * Version of the component
   */
  readonly version: string;

  /**
   * If matched, under what name should it be added to the set of dynamic values
   *
   * These will be used to substitute placeholders in the message string, where
   * placeholders look like `{resolve:XYZ}`.
   *
   * If there is more than one component with the same dynamic name, they are
   * joined by ','.
   *
   * @default - Don't add to the set of dynamic values.
   */
  readonly dynamicName?: string;

  /**
   * If matched, what we should put in the set of dynamic values insstead of the version.
   *
   * Only used if `dynamicName` is set; by default we will add the actual version
   * of the component.
   *
   * @default - The version.
   */
  readonly dynamicValue?: string;
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
export class Notices {
  /**
   * Create an instance. Note that this replaces the singleton.
   */
  public static create(props: NoticesProps): Notices {
    this._instance = new Notices(props);
    return this._instance;
  }

  /**
   * Get the singleton instance. May return `undefined` if `create` has not been called.
   */
  public static get(): Notices | undefined {
    return this._instance;
  }

  private static _instance: Notices | undefined;

  private readonly context: Context;
  private readonly output: string;
  private readonly acknowledgedIssueNumbers: Set<Number>;
  private readonly includeAcknowlegded: boolean;
  private readonly httpOptions: SdkHttpOptions;
  private readonly ioMessages: IoDefaultMessages;

  private data: Set<Notice> = new Set();

  // sets don't deduplicate interfaces, so we use a map.
  private readonly bootstrappedEnvironments: Map<string, BootstrappedEnvironment> = new Map();

  private constructor(props: NoticesProps) {
    this.context = props.context;
    this.acknowledgedIssueNumbers = new Set(this.context.get('acknowledged-issue-numbers') ?? []);
    this.includeAcknowlegded = props.includeAcknowledged ?? false;
    this.output = props.output ?? 'cdk.out';
    this.httpOptions = props.httpOptions ?? {};
    this.ioMessages = new IoDefaultMessages(asIoHelper(props.ioHost, 'notices' as any /* forcing a CliAction to a ToolkitAction */));
  }

  /**
   * Add a bootstrap information to filter on. Can have multiple values
   * in case of multi-environment deployments.
   */
  public addBootstrappedEnvironment(bootstrapped: BootstrappedEnvironment) {
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
  public async refresh(options: NoticesRefreshOptions = {}) {
    try {
      const underlyingDataSource = options.dataSource ?? new WebsiteNoticeDataSource(this.ioMessages, this.httpOptions);
      const dataSource = new CachedDataSource(this.ioMessages, CACHE_FILE_PATH, underlyingDataSource, options.force ?? false);
      const notices = await dataSource.fetch();
      this.data = new Set(this.includeAcknowlegded ? notices : notices.filter(n => !this.acknowledgedIssueNumbers.has(n.issueNumber)));
    } catch (e: any) {
      this.ioMessages.debug(`Could not refresh notices: ${e}`);
    }
  }

  /**
   * Display the relevant notices (unless context dictates we shouldn't).
   */
  public display(options: NoticesPrintOptions = {}) {
    const filteredNotices = new NoticesFilter(this.ioMessages).filter({
      data: Array.from(this.data),
      cliVersion: versionNumber(),
      outDir: this.output,
      bootstrappedEnvironments: Array.from(this.bootstrappedEnvironments.values()),
    });

    if (filteredNotices.length > 0) {
      void this.ioMessages.notify(IO.CDK_TOOLKIT_I0100.msg([
        '',
        'NOTICES         (What\'s this? https://github.com/aws/aws-cdk/wiki/CLI-Notices)',
        '',
      ].join('\n')));
      for (const filtered of filteredNotices) {
        const formatted = filtered.format() + '\n';
        switch (filtered.notice.severity) {
          case 'warning':
            void this.ioMessages.notify(IO.CDK_TOOLKIT_W0101.msg(formatted));
            break;
          case 'error':
            void this.ioMessages.notify(IO.CDK_TOOLKIT_E0101.msg(formatted));
            break;
          default:
            void this.ioMessages.notify(IO.CDK_TOOLKIT_I0101.msg(formatted));
            break;
        }
      }
      void this.ioMessages.notify(IO.CDK_TOOLKIT_I0100.msg(
        `If you don’t want to see a notice anymore, use "cdk acknowledge <id>". For example, "cdk acknowledge ${filteredNotices[0].notice.issueNumber}".`,
      ));
    }

    if (options.showTotal ?? false) {
      void this.ioMessages.notify(IO.CDK_TOOLKIT_I0100.msg(
        `\nThere are ${filteredNotices.length} unacknowledged notice(s).`,
      ));
    }
  }
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
 * Normalizes the given components structure into DNF form
 */
function normalizeComponents(xs: Array<Component | Component[]>): Component[][] {
  return xs.map(x => Array.isArray(x) ? x : [x]);
}

function renderConjunction(xs: Component[]): string {
  return xs.map(c => `${c.name}: ${c.version}`).join(' AND ');
}

/**
 * Notice after passing the filter. A filter can augment a notice with
 * dynamic values as it has access to the dynamic matching data.
 */
export class FilteredNotice {
  private readonly dynamicValues: { [key: string]: string } = {};

  public constructor(public readonly notice: Notice) {
  }

  public addDynamicValue(key: string, value: string) {
    this.dynamicValues[`{resolve:${key}}`] = value;
  }

  public format(): string {
    const componentsValue = normalizeComponents(this.notice.components).map(renderConjunction).join(', ');
    return this.resolveDynamicValues([
      `${this.notice.issueNumber}\t${this.notice.title}`,
      this.formatOverview(),
      `\tAffected versions: ${componentsValue}`,
      `\tMore information at: https://github.com/aws/aws-cdk/issues/${this.notice.issueNumber}`,
    ].join('\n\n') + '\n');
  }

  private formatOverview() {
    const wrap = (s: string) => s.replace(/(?![^\n]{1,60}$)([^\n]{1,60})\s/g, '$1\n');

    const heading = 'Overview: ';
    const separator = `\n\t${' '.repeat(heading.length)}`;
    const content = wrap(this.notice.overview)
      .split('\n')
      .join(separator);

    return '\t' + heading + content;
  }

  private resolveDynamicValues(input: string): string {
    const pattern = new RegExp(Object.keys(this.dynamicValues).join('|'), 'g');
    return input.replace(pattern, (matched) => this.dynamicValues[matched] ?? matched);
  }
}

export interface NoticeDataSource {
  fetch(): Promise<Notice[]>;
}

export class WebsiteNoticeDataSource implements NoticeDataSource {
  private readonly options: SdkHttpOptions;

  constructor(private readonly ioMessages: IoDefaultMessages, options: SdkHttpOptions = {}) {
    this.options = options;
  }

  fetch(): Promise<Notice[]> {
    const timeout = 3000;
    return new Promise((resolve, reject) => {
      let req: ClientRequest | undefined;

      let timer = setTimeout(() => {
        if (req) {
          req.destroy(new ToolkitError('Request timed out'));
        }
      }, timeout);

      timer.unref();

      const options: RequestOptions = {
        agent: AwsCliCompatible.proxyAgent(this.options),
      };

      try {
        req = https.get('https://cli.cdk.dev-tools.aws.dev/notices.json',
          options,
          res => {
            if (res.statusCode === 200) {
              res.setEncoding('utf8');
              let rawData = '';
              res.on('data', (chunk) => {
                rawData += chunk;
              });
              res.on('end', () => {
                try {
                  const data = JSON.parse(rawData).notices as Notice[];
                  if (!data) {
                    throw new ToolkitError("'notices' key is missing");
                  }
                  this.ioMessages.debug('Notices refreshed');
                  resolve(data ?? []);
                } catch (e: any) {
                  reject(new ToolkitError(`Failed to parse notices: ${formatErrorMessage(e)}`));
                }
              });
              res.on('error', e => {
                reject(new ToolkitError(`Failed to fetch notices: ${formatErrorMessage(e)}`));
              });
            } else {
              reject(new ToolkitError(`Failed to fetch notices. Status code: ${res.statusCode}`));
            }
          });
        req.on('error', reject);
      } catch (e: any) {
        reject(new ToolkitError(`HTTPS 'get' call threw an error: ${formatErrorMessage(e)}`));
      }
    });
  }
}

interface CachedNotices {
  expiration: number;
  notices: Notice[];
}

const TIME_TO_LIVE_SUCCESS = 60 * 60 * 1000; // 1 hour
const TIME_TO_LIVE_ERROR = 1 * 60 * 1000; // 1 minute

export class CachedDataSource implements NoticeDataSource {
  constructor(
    private readonly ioMessages: IoDefaultMessages,
    private readonly fileName: string,
    private readonly dataSource: NoticeDataSource,
    private readonly skipCache?: boolean) {
  }

  async fetch(): Promise<Notice[]> {
    const cachedData = await this.load();
    const data = cachedData.notices;
    const expiration = cachedData.expiration ?? 0;

    if (Date.now() > expiration || this.skipCache) {
      const freshData = await this.fetchInner();
      await this.save(freshData);
      return freshData.notices;
    } else {
      this.ioMessages.debug(`Reading cached notices from ${this.fileName}`);
      return data;
    }
  }

  private async fetchInner(): Promise<CachedNotices> {
    try {
      return {
        expiration: Date.now() + TIME_TO_LIVE_SUCCESS,
        notices: await this.dataSource.fetch(),
      };
    } catch (e) {
      this.ioMessages.debug(`Could not refresh notices: ${e}`);
      return {
        expiration: Date.now() + TIME_TO_LIVE_ERROR,
        notices: [],
      };
    }
  }

  private async load(): Promise<CachedNotices> {
    const defaultValue = {
      expiration: 0,
      notices: [],
    };

    try {
      return fs.existsSync(this.fileName)
        ? await fs.readJSON(this.fileName) as CachedNotices
        : defaultValue;
    } catch (e) {
      this.ioMessages.debug(`Failed to load notices from cache: ${e}`);
      return defaultValue;
    }
  }

  private async save(cached: CachedNotices): Promise<void> {
    try {
      await fs.writeJSON(this.fileName, cached);
    } catch (e) {
      this.ioMessages.debug(`Failed to store notices in the cache: ${e}`);
    }
  }
}
