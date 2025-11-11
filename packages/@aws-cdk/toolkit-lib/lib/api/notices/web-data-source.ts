import type { ClientRequest } from 'node:http';
import type { RequestOptions } from 'node:https';
import * as https from 'node:https';
import type { Notice, NoticeDataSource } from './types';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { formatErrorMessage, humanHttpStatusError, humanNetworkError } from '../../util';
import { NetworkDetector } from '../../util/network-detector';
import type { IoHelper } from '../io/private';

/**
 * A data source that fetches notices from the CDK notices data source
 */
export class WebsiteNoticeDataSourceProps {
  /**
   * The URL to load notices from.
   *
   * Note this must be a valid JSON document in the CDK notices data schema.
   *
   * @see https://github.com/cdklabs/aws-cdk-notices
   *
   * @default - Official CDK notices
   */
  readonly url?: string | URL;

  /**
   * The agent responsible for making the network requests.
   *
   * Use this so set up a proxy connection.
   *
   * @default - Uses the shared global node agent
   */
  readonly agent?: https.Agent;

  /**
   * Whether or not we want to skip the check for if we have already determined we are in
   * a network-less environment. Forces WebsiteNoticeDataSource to make a network call.
   *
   * @default false
   */
  readonly skipNetworkCache?: boolean;
}

export class WebsiteNoticeDataSource implements NoticeDataSource {
  /**
   * The URL notices are loaded from.
   */
  public readonly url: any;

  private readonly agent?: https.Agent;

  constructor(private readonly ioHelper: IoHelper, props: WebsiteNoticeDataSourceProps = {}) {
    this.agent = props.agent;
    this.url = props.url ?? 'https://cli.cdk.dev-tools.aws.dev/notices.json';
  }

  async fetch(): Promise<Notice[]> {
    // Check connectivity before attempting network request
    const hasConnectivity = await NetworkDetector.hasConnectivity(this.agent);
    if (!hasConnectivity) {
      throw new ToolkitError('No internet connectivity detected');
    }

    // We are observing lots of timeouts when running in a massively parallel
    // integration test environment, so wait for a longer timeout there.
    //
    // In production, have a short timeout to not hold up the user experience.
    const timeout = process.env.TESTING_CDK ? 30_000 : 3_000;

    const options: RequestOptions = {
      agent: this.agent,
    };

    const notices = await new Promise<Notice[]>((resolve, reject) => {
      let req: ClientRequest | undefined;

      let timer = setTimeout(() => {
        if (req) {
          req.destroy(new ToolkitError('Request timed out'));
        }
      }, timeout);

      timer.unref();

      try {
        req = https.get(this.url,
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
                    throw new ToolkitError("'notices' key is missing from received data");
                  }
                  resolve(data ?? []);
                } catch (e: any) {
                  reject(ToolkitError.withCause(`Parse error: ${formatErrorMessage(e)}`, e));
                }
              });
              res.on('error', e => {
                reject(ToolkitError.withCause(formatErrorMessage(e), e));
              });
            } else {
              reject(new ToolkitError(`${humanHttpStatusError(res.statusCode!)} (Status code: ${res.statusCode})`));
            }
          });
        req.on('error', e => {
          reject(ToolkitError.withCause(humanNetworkError(e), e));
        });
      } catch (e: any) {
        reject(ToolkitError.withCause(formatErrorMessage(e), e));
      }
    });

    await this.ioHelper.defaults.debug('Notices refreshed');
    return notices;
  }
}
