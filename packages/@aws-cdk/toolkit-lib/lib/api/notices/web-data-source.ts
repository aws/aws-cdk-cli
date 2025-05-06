import type { ClientRequest } from 'http';
import type { RequestOptions } from 'https';
import * as https from 'node:https';
import type { SdkHttpOptions } from '../aws-auth';
import type { Notice, NoticeDataSource } from './types';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { formatErrorMessage, humanHttpStatusError, humanNetworkError } from '../../util';
import { ProxyAgentProvider } from '../aws-auth/private';
import type { IoHelper } from '../io/private';
import { IO } from '../io/private';

export class WebsiteNoticeDataSource implements NoticeDataSource {
  private readonly options: SdkHttpOptions;

  constructor(private readonly ioHelper: IoHelper, options: SdkHttpOptions = {}) {
    this.options = options;
  }

  async fetch(): Promise<Notice[]> {
    const timeout = 3000;

    const options: RequestOptions = {
      agent: await new ProxyAgentProvider(this.ioHelper).create(this.options),
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

    await this.ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg('Notices refreshed'));
    return notices;
  }
}
