import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recordLastSend, takeLastSend } from '../../../lib/cli/telemetry/last-send';
import { withEnv } from '../../_helpers/with-env';

let cdkHome: string;

/**
 * `cdkHomeDir()` reads CDK_HOME on every call, so pointing it at a temp directory is enough to keep
 * these tests off the developer's real cache.
 */
function inTempHome<A>(block: () => Promise<A>): Promise<A> {
  return withEnv(block, { CDK_HOME: cdkHome });
}

function breadcrumbFile(): string {
  return path.join(cdkHome, 'cache', 'telemetry-last-send.json');
}

describe('last send outcome', () => {
  beforeEach(() => {
    cdkHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-home-'));
  });

  afterEach(() => {
    fs.rmSync(cdkHome, { recursive: true, force: true });
  });

  test('round-trips an outcome', async () => {
    await inTempHome(async () => {
      recordLastSend({ ok: false, statusCode: 500, reason: 'UnexpectedStatusCode: 500', at: '2026-01-01T00:00:00.000Z' });

      await expect(takeLastSend()).resolves.toEqual({
        ok: false,
        statusCode: 500,
        reason: 'UnexpectedStatusCode: 500',
        at: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  test('creates the cache directory if it does not exist', async () => {
    await inTempHome(async () => {
      fs.rmSync(path.join(cdkHome, 'cache'), { recursive: true, force: true });

      recordLastSend({ ok: true, statusCode: 200, at: new Date().toISOString() });

      expect(fs.existsSync(breadcrumbFile())).toBe(true);
    });
  });

  test('consumes the outcome, so a single failure is reported once', async () => {
    await inTempHome(async () => {
      recordLastSend({ ok: false, reason: 'ECONNREFUSED', at: new Date().toISOString() });

      await expect(takeLastSend()).resolves.toMatchObject({ ok: false });
      await expect(takeLastSend()).resolves.toBeUndefined();
      expect(fs.existsSync(breadcrumbFile())).toBe(false);
    });
  });

  test('reports nothing when there has never been a send', async () => {
    await inTempHome(async () => {
      await expect(takeLastSend()).resolves.toBeUndefined();
    });
  });

  test('ignores a corrupt breadcrumb instead of failing', async () => {
    await inTempHome(async () => {
      fs.mkdirSync(path.dirname(breadcrumbFile()), { recursive: true });
      fs.writeFileSync(breadcrumbFile(), 'not json');

      await expect(takeLastSend()).resolves.toBeUndefined();
    });
  });

  test('ignores a breadcrumb that is missing the outcome', async () => {
    await inTempHome(async () => {
      fs.mkdirSync(path.dirname(breadcrumbFile()), { recursive: true });
      fs.writeFileSync(breadcrumbFile(), JSON.stringify({ at: 'whenever' }));

      await expect(takeLastSend()).resolves.toBeUndefined();
    });
  });

  test('writing is silent when the location is unusable', async () => {
    // Diagnostics must never become a failure of their own.
    await withEnv(async () => {
      expect(() => recordLastSend({ ok: true, at: new Date().toISOString() })).not.toThrow();
    }, { CDK_HOME: path.join(cdkHome, 'a-file') });
  });
});
