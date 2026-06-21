import { forceS3PathStyle } from '../../lib/s3-path-style';

const ENV_VARS = ['CDK_S3_FORCE_PATH_STYLE', 'AWS_ENDPOINT_URL_S3', 'AWS_ENDPOINT_URL'];

describe('forceS3PathStyle', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of ENV_VARS) {
      original[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of ENV_VARS) {
      if (original[v] === undefined) {
        delete process.env[v];
      } else {
        process.env[v] = original[v];
      }
    }
  });

  test('returns undefined when nothing is configured', () => {
    expect(forceS3PathStyle()).toBeUndefined();
  });

  test('CDK_S3_FORCE_PATH_STYLE forces path-style explicitly', () => {
    process.env.CDK_S3_FORCE_PATH_STYLE = '1';
    expect(forceS3PathStyle()).toBe(true);
  });

  test.each([
    'http://localhost:4566',
    'https://localhost',
    'http://127.0.0.1:9000',
    'http://127.1.2.3:9000',
    'http://[::1]:4566',
    'http://LOCALHOST:4566',
  ])('auto-detects loopback endpoint %s from AWS_ENDPOINT_URL_S3', (endpoint) => {
    process.env.AWS_ENDPOINT_URL_S3 = endpoint;
    expect(forceS3PathStyle()).toBe(true);
  });

  test('falls back to AWS_ENDPOINT_URL when AWS_ENDPOINT_URL_S3 is unset', () => {
    process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
    expect(forceS3PathStyle()).toBe(true);
  });

  test('AWS_ENDPOINT_URL_S3 takes precedence over AWS_ENDPOINT_URL', () => {
    process.env.AWS_ENDPOINT_URL_S3 = 'https://s3.amazonaws.com';
    process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
    expect(forceS3PathStyle()).toBeUndefined();
  });

  test.each([
    'https://s3.amazonaws.com',
    'https://s3.us-east-1.amazonaws.com',
    'https://my-custom-endpoint.example.com',
  ])('leaves non-loopback endpoint %s on the SDK default', (endpoint) => {
    process.env.AWS_ENDPOINT_URL_S3 = endpoint;
    expect(forceS3PathStyle()).toBeUndefined();
  });

  test('ignores an unparseable endpoint', () => {
    process.env.AWS_ENDPOINT_URL_S3 = 'not a url';
    expect(forceS3PathStyle()).toBeUndefined();
  });
});
