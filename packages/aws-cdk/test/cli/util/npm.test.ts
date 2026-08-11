import nock from 'nock';
import { fetchNpmVersionInfo } from '../../../lib/cli/util/npm';

const REGISTRY = 'https://registry.npmjs.org';

beforeEach(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

test('returns latest version and deprecation info for the current version', async () => {
  nock(REGISTRY)
    .get('/aws-cdk/latest')
    .reply(200, { name: 'aws-cdk', version: '2.1133.0' })
    .get('/aws-cdk/3.0.0')
    .reply(200, { name: 'aws-cdk', version: '3.0.0', deprecated: 'This version was published accidentally.' });

  await expect(fetchNpmVersionInfo('3.0.0')).resolves.toEqual({
    latestVersion: '2.1133.0',
    deprecated: 'This version was published accidentally.',
  });
});

test('returns no deprecation info when the current version is not deprecated', async () => {
  nock(REGISTRY)
    .get('/aws-cdk/latest')
    .reply(200, { name: 'aws-cdk', version: '2.1133.0' })
    .get('/aws-cdk/2.1000.0')
    .reply(200, { name: 'aws-cdk', version: '2.1000.0' });

  await expect(fetchNpmVersionInfo('2.1000.0')).resolves.toEqual({
    latestVersion: '2.1133.0',
    deprecated: undefined,
  });
});

test('tolerates the current version not existing on the registry', async () => {
  nock(REGISTRY)
    .get('/aws-cdk/latest')
    .reply(200, { name: 'aws-cdk', version: '2.1133.0' })
    .get('/aws-cdk/0.0.0')
    .reply(404, { error: 'Not found' });

  await expect(fetchNpmVersionInfo('0.0.0')).resolves.toEqual({
    latestVersion: '2.1133.0',
    deprecated: undefined,
  });
});

test('fails when the latest version request returns a non-200 status', async () => {
  nock(REGISTRY)
    .get('/aws-cdk/latest')
    .reply(500, 'Internal Server Error')
    .get('/aws-cdk/2.1000.0')
    .reply(200, { name: 'aws-cdk', version: '2.1000.0' });

  await expect(fetchNpmVersionInfo('2.1000.0')).rejects.toThrow(/status code 500/);
});

test('fails when the registry returns invalid JSON', async () => {
  nock(REGISTRY)
    .get('/aws-cdk/latest')
    .reply(200, 'not json')
    .get('/aws-cdk/2.1000.0')
    .reply(200, { name: 'aws-cdk', version: '2.1000.0' });

  await expect(fetchNpmVersionInfo('2.1000.0')).rejects.toThrow(/could not parse response/);
});

test('fails when the registry response has no version', async () => {
  nock(REGISTRY)
    .get('/aws-cdk/latest')
    .reply(200, { name: 'aws-cdk' })
    .get('/aws-cdk/2.1000.0')
    .reply(200, { name: 'aws-cdk', version: '2.1000.0' });

  await expect(fetchNpmVersionInfo('2.1000.0')).rejects.toThrow(/did not contain a version/);
});
