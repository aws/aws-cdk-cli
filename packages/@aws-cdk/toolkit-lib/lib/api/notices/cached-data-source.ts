import * as fs from 'fs-extra';
import type { Notice, NoticeDataSource } from './types';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { IoDefaultMessages } from '../io/private';

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
    private readonly skipCache?: boolean,
  ) {
  }

  async fetch(): Promise<Notice[]> {
    const cachedData = await this.load();
    const data = cachedData.notices;
    const expiration = cachedData.expiration ?? 0;

    if (Date.now() > expiration || this.skipCache) {
      let updatedData: CachedNotices = cachedData;

      try {
        updatedData = await this.fetchInner();
      } catch (e) {
        this.ioMessages.debug(`Could not refresh notices: ${e}`);
        updatedData = {
          expiration: Date.now() + TIME_TO_LIVE_ERROR,
          notices: [],
        };
        throw ToolkitError.withCause('Failed to load CDK notices. Please try again later.', e);
      } finally {
        await this.save(updatedData);
      }
      return updatedData.notices;
    } else {
      this.ioMessages.debug(`Reading cached notices from ${this.fileName}`);
      return data;
    }
  }

  private async fetchInner(): Promise<CachedNotices> {
    return {
      expiration: Date.now() + TIME_TO_LIVE_SUCCESS,
      notices: await this.dataSource.fetch(),
    };
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
