/* eslint-disable import/order */
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { setTimeout as _setTimeout } from 'timers';
import { promisify } from 'util';
import * as npm from '../../lib/cli/util/npm';
import { displayVersionMessage, getVersionMessages, VersionCheckTTL } from '../../lib/cli/version';
import { isDeveloperBuild } from '../../lib/cli/version-util';
import { TestIoHost } from '../_helpers/io-host';

jest.setTimeout(10_000);

const setTimeout = promisify(_setTimeout);

function tmpfile(): string {
  return `/tmp/version-${Math.floor(Math.random() * 10000)}`;
}

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper();

beforeEach(() => {
  process.chdir(os.tmpdir()); // Need a chdir because in the workspace 'npm view' will take a long time
});

afterEach(done => {
  sinon.restore();
  done();
});

test('initialization fails on unwritable directory', () => {
  const cacheFile = tmpfile();
  sinon.stub(fs, 'mkdirsSync').withArgs(path.dirname(cacheFile)).throws('Cannot make directory');
  expect(() => new VersionCheckTTL(cacheFile)).toThrow(/not writable/);
});

test('cache file responds correctly when file is not present', async () => {
  const cache = new VersionCheckTTL(tmpfile(), 1);
  expect(await cache.hasExpired()).toBeTruthy();
});

test('cache file honours the specified TTL', async () => {
  const cache = new VersionCheckTTL(tmpfile(), 1);
  await cache.update();
  expect(await cache.hasExpired()).toBeFalsy();
  await setTimeout(1001); // Just above 1 sec in ms
  expect(await cache.hasExpired()).toBeTruthy();
});

test('Skip version check if cache has not expired', async () => {
  const cache = new VersionCheckTTL(tmpfile(), 100);
  await cache.update();
  expect(await getVersionMessages('0.0.0', cache)).toEqual([]);
});

test('Version specified is stored in the TTL file', async () => {
  const cacheFile = tmpfile();
  const cache = new VersionCheckTTL(cacheFile, 1);
  await cache.update('1.1.1');
  const storedVersion = fs.readFileSync(cacheFile, 'utf8');
  expect(storedVersion).toBe('1.1.1');
});

test('No Version specified for storage in the TTL file', async () => {
  const cacheFile = tmpfile();
  const cache = new VersionCheckTTL(cacheFile, 1);
  await cache.update();
  const storedVersion = fs.readFileSync(cacheFile, 'utf8');
  expect(storedVersion).toBe('');
});

test('Skip version check if environment variable is set', async () => {
  sinon.stub(process, 'stdout').value({ ...process.stdout, isTTY: true });
  sinon.stub(process, 'env').value({ ...process.env, CDK_DISABLE_VERSION_CHECK: '1' });
  await displayVersionMessage(ioHelper);
  expect(ioHost.notifySpy).not.toHaveBeenCalled();
});

describe('version message', () => {
  const previousIsTty = process.stdout.isTTY;
  beforeAll(() => {
    process.stdout.isTTY = true;
  });

  afterAll(() => {
    process.stdout.isTTY = previousIsTty;
  });

  test('Prints messages when a new version is available', async () => {
    const mockCache = new VersionCheckTTL(tmpfile());
    jest.spyOn(mockCache, 'hasExpired').mockResolvedValue(true);

    jest.spyOn(npm, 'execNpmView').mockResolvedValue({
      latestVersion: '2.0.0',
      deprecated: undefined,
    });

    const messages = await getVersionMessages('1.0.0', mockCache);
    expect(messages.some(msg => msg.includes('Newer version of CDK is available'))).toBeTruthy();
    expect(messages.some(msg => msg.includes('Information about upgrading from version 1.x to version 2.x'))).toBeTruthy();
    expect(messages.some(msg => msg.includes('Upgrade recommended (npm install -g aws-cdk)'))).toBeTruthy();
  });

  test('Does not include major upgrade documentation when unavailable', async () => {
    const mockCache = new VersionCheckTTL(tmpfile());
    jest.spyOn(mockCache, 'hasExpired').mockResolvedValue(true);

    jest.spyOn(npm, 'execNpmView').mockResolvedValue({
      latestVersion: '2.1000.0',
      deprecated: undefined,
    });

    const messages = await getVersionMessages('2.179.0', mockCache);
    const hasUpgradeDoc = messages.some(msg =>
      msg.includes('Information about upgrading from version 1.x to version 2.x'),
    );
    expect(hasUpgradeDoc).toBeFalsy();
  });

  test('Prints a message when a deprecated version is used', async () => {
    const mockCache = new VersionCheckTTL(tmpfile());
    jest.spyOn(mockCache, 'hasExpired').mockResolvedValue(true);

    jest.spyOn(npm, 'execNpmView').mockResolvedValue({
      latestVersion: '2.0.0',
      deprecated: 'This version is deprecated.',
    });

    const messages = await getVersionMessages('1.0.0', mockCache);
    expect(messages.some(msg => msg.includes('This version is deprecated'))).toBeTruthy();
  });

  test('Does not print message when current version is up to date', async () => {
    const mockCache = new VersionCheckTTL(tmpfile());
    jest.spyOn(mockCache, 'hasExpired').mockResolvedValue(true);

    jest.spyOn(npm, 'execNpmView').mockResolvedValue({
      latestVersion: '1.0.0',
      deprecated: undefined,
    });

    const messages = await getVersionMessages('1.0.0', mockCache);
    expect(messages).toEqual([]);
  });
});

test('isDeveloperBuild call does not throw an error', () => {
  // To be frank: this is just to shut CodeCov up. It don't want to make an assertion
  // that the value is `true` when running tests, because I won't want to make too
  // many assumptions for no good reason.

  isDeveloperBuild();

  // THEN: should not explode
});
