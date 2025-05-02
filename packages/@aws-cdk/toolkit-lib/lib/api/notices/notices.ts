import * as path from 'path';
import { cdkCacheDir } from '../../util';
import type { SdkHttpOptions } from '../aws-auth';
import type { Context } from '../context';
import type { IIoHost } from '../io';
import { CachedDataSource } from './cached-data-source';
import { NoticesFilter } from './filter';
import type { BootstrappedEnvironment, Notice, NoticeDataSource } from './types';
import { WebsiteNoticeDataSource } from './web-data-source';
import type { IoHelper } from '../io/private';
import { IO, asIoHelper, IoDefaultMessages } from '../io/private';

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
  private readonly ioHelper: IoHelper;
  private readonly ioMessages: IoDefaultMessages;
  private readonly cliVersion: string;

  private data: Set<Notice> = new Set();

  // sets don't deduplicate interfaces, so we use a map.
  private readonly bootstrappedEnvironments: Map<string, BootstrappedEnvironment> = new Map();

  private constructor(props: NoticesProps) {
    this.context = props.context;
    this.acknowledgedIssueNumbers = new Set(this.context.get('acknowledged-issue-numbers') ?? []);
    this.includeAcknowlegded = props.includeAcknowledged ?? false;
    this.output = props.output ?? 'cdk.out';
    this.httpOptions = props.httpOptions ?? {};
    this.ioHelper = asIoHelper(props.ioHost, 'notices' as any /* forcing a CliAction to a ToolkitAction */);
    this.ioMessages = new IoDefaultMessages(this.ioHelper);
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
   * To make sure this never crashes the CLI process, all failures are caught and
   * silently logged.
   *
   * If context is configured to not display notices, this will no-op.
   */
  public async refresh(options: NoticesRefreshOptions = {}) {
    try {
      const underlyingDataSource = options.dataSource ?? new WebsiteNoticeDataSource(this.ioHelper, this.httpOptions);
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
      cliVersion: this.cliVersion,
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
