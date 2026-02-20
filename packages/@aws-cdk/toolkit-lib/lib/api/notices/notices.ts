import type { Agent } from 'https';
import * as path from 'path';
import { cdkCacheDir } from '../../util';
import type { Context } from '../context';
import type { IIoHost } from '../io';
import { CachedDataSource } from './cached-data-source';
import type { FilteredNotice } from './filter';
import { NoticesFilter } from './filter';
import type { BootstrappedEnvironment, Notice, NoticeDataSource } from './types';
import { WebsiteNoticeDataSource } from './web-data-source';
import type { IoHelper } from '../io/private';
import { IO, asIoHelper } from '../io/private';

const CACHE_FILE_PATH = path.join(cdkCacheDir(), 'notices.json');

/**
 * Options for the HTTPS requests made by Notices
 */
export interface NoticesHttpOptions {
  /**
   * The agent responsible for making the network requests.
   *
   * Use this so set up a proxy connection.
   *
   * @default - Uses the shared global node agent
   */
  readonly agent?: Agent;
}

export interface NoticesProps {
  /**
   * CDK context
   */
  readonly context: Context;

  /**
   * Global CLI option for output directory for synthesized cloud assembly
   *
   * @default 'cdk.out'
   */
  readonly output?: string;

  /**
   * The detected CDK app language.
   *
   * @default - no language filtering
   */
  readonly language?: string;

  /**
   * Options for the HTTPS requests made by Notices
   */
  readonly httpOptions?: NoticesHttpOptions;

  /**
   * Where messages are going to be sent
   */
  readonly ioHost: IIoHost;

  /**
   * The version of the CLI
   */
  readonly cliVersion: string;
}

export interface NoticesFilterOptions {
  /**
   * Include notices that have already been acknowledged.
   *
   * @default false
   */
  readonly includeAcknowledged?: boolean;
}

export interface NoticesDisplayOptions extends NoticesFilterOptions {
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
  private readonly language?: string;
  private readonly acknowledgedIssueNumbers: Set<Number>;
  private readonly httpOptions: NoticesHttpOptions;
  private readonly ioHelper: IoHelper;
  private readonly cliVersion: string;

  private data: Set<Notice> = new Set();

  // sets don't deduplicate interfaces, so we use a map.
  private readonly bootstrappedEnvironments: Map<string, BootstrappedEnvironment> = new Map();

  private constructor(props: NoticesProps) {
    this.context = props.context;
    this.acknowledgedIssueNumbers = new Set(this.context.get('acknowledged-issue-numbers') ?? []);
    this.output = props.output ?? 'cdk.out';
    this.language = props.language;
    this.httpOptions = props.httpOptions ?? {};
    this.ioHelper = asIoHelper(props.ioHost, 'notices' as any /* forcing a CliAction to a ToolkitAction */);
    this.cliVersion = props.cliVersion;
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
   *
   * This method throws an error if the data source fails to fetch notices.
   * When using, consider if execution should halt immdiately or if catching the error and continuing is more appropriate
   *
   * @throws on failure to refresh the data source
   */
  public async refresh(options: NoticesRefreshOptions = {}) {
    const innerDataSource = options.dataSource ?? new WebsiteNoticeDataSource(this.ioHelper, this.httpOptions);
    const dataSource = new CachedDataSource(this.ioHelper, CACHE_FILE_PATH, innerDataSource, options.force ?? false);
    const notices = await dataSource.fetch();
    this.data = new Set(notices);
  }

  /**
   * Filter the data source for relevant notices
   */
  public async filter(options: NoticesDisplayOptions = {}): Promise<FilteredNotice[]> {
    return new NoticesFilter(this.ioHelper).filter({
      data: this.noticesFromData(options.includeAcknowledged ?? false),
      cliVersion: this.cliVersion,
      outDir: this.output,
      bootstrappedEnvironments: Array.from(this.bootstrappedEnvironments.values()),
      language: this.language,
    });
  }

  /**
   * Display the relevant notices (unless context dictates we shouldn't).
   */
  public async display(options: NoticesDisplayOptions = {}): Promise<void> {
    const filteredNotices = await this.filter(options);

    if (filteredNotices.length > 0) {
      await this.ioHelper.notify(IO.CDK_TOOLKIT_I0100.msg([
        '',
        'NOTICES         (What\'s this? https://github.com/aws/aws-cdk/wiki/CLI-Notices)',
        '',
      ].join('\n')));
      for (const filtered of filteredNotices) {
        const formatted = filtered.format() + '\n';
        switch (filtered.notice.severity) {
          case 'warning':
            await this.ioHelper.notify(IO.CDK_TOOLKIT_W0101.msg(formatted));
            break;
          case 'error':
            await this.ioHelper.notify(IO.CDK_TOOLKIT_E0101.msg(formatted));
            break;
          default:
            await this.ioHelper.notify(IO.CDK_TOOLKIT_I0101.msg(formatted));
            break;
        }
      }
      await this.ioHelper.notify(IO.CDK_TOOLKIT_I0100.msg(
        `If you don’t want to see a notice anymore, use "cdk acknowledge <id>". For example, "cdk acknowledge ${filteredNotices[0].notice.issueNumber}".`,
      ));
    }

    if (options.showTotal ?? false) {
      await this.ioHelper.notify(IO.CDK_TOOLKIT_I0100.msg(
        `\nThere are ${filteredNotices.length} unacknowledged notice(s).`,
      ));
    }
  }

  /**
   * List all notices available in the data source.
   *
   * @param includeAcknowlegded - Whether to include acknowledged notices.
   */
  private noticesFromData(includeAcknowlegded = false): Notice[] {
    const data = Array.from(this.data);

    if (includeAcknowlegded) {
      return data;
    }

    return data.filter(n => !this.acknowledgedIssueNumbers.has(n.issueNumber));
  }
}

