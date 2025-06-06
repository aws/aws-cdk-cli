import type { ClientRequest } from 'node:http';
import type { RequestOptions } from 'node:https';
import * as https from 'node:https';
import type { Notice, NoticeDataSource } from './types';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { formatErrorMessage, humanHttpStatusError, humanNetworkError } from '../../util';
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
   * @defaultValue - official CDK notices
   */
  readonly url?: string | URL;
  /**
   * The agent responsible for making the network requests.
   *
   * Use this so set up a proxy connection.
   *
   * @defaultValue - uses the shared global node agent
   */
  readonly agent?: https.Agent;
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
    const timeout = 3000;

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
