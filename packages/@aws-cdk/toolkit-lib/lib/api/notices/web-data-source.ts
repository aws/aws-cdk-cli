import type { ClientRequest } from 'http';
import type { RequestOptions } from 'https';
import * as https from 'node:https';
import { formatErrorMessage } from '../../util';
import type { SdkHttpOptions } from '../aws-auth';
import { ProxyAgentProvider } from '../aws-auth/private';
import type { IoHelper } from '../io/private';
import { IO } from '../io/private';
import { ToolkitError } from '../toolkit-error';
import type { Notice, NoticeDataSource } from './types';

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
                    throw new ToolkitError("'notices' key is missing");
                  }
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

    await this.ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg('Notices refreshed'));
    return notices;
  }
}
