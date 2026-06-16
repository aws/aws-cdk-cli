import * as s3 from '@aws-sdk/client-s3';
import { MockSdk } from '../../_helpers/mock-sdk';

describe('S3 path-style addressing', () => {
  const ENV_VARS = ['CDK_S3_FORCE_PATH_STYLE', 'AWS_ENDPOINT_URL_S3', 'AWS_ENDPOINT_URL'];
  const original: Record<string, string | undefined> = {};
  let s3ClientSpy: jest.SpyInstance;

  beforeEach(() => {
    for (const v of ENV_VARS) {
      original[v] = process.env[v];
      delete process.env[v];
    }
    s3ClientSpy = jest.spyOn(s3, 'S3Client').mockImplementation(() => ({}) as any);
  });

  afterEach(() => {
    s3ClientSpy.mockRestore();
    for (const v of ENV_VARS) {
      if (original[v] === undefined) {
        delete process.env[v];
      } else {
        process.env[v] = original[v];
      }
    }
  });

  // MockSdk only supplies fake credentials and region; `.s3()` is the real SDK
  // method under test. Returns the `forcePathStyle` value it passes when
  // constructing the underlying S3 client.
  function forcePathStylePassedToS3Client(): boolean | undefined {
    new MockSdk().s3();
    return s3ClientSpy.mock.calls[0][0].forcePathStyle;
  }

  test('is forced when CDK_S3_FORCE_PATH_STYLE is set', () => {
    process.env.CDK_S3_FORCE_PATH_STYLE = '1';

    expect(forcePathStylePassedToS3Client()).toBe(true);
  });

  test('is auto-detected for a loopback endpoint', () => {
    process.env.AWS_ENDPOINT_URL_S3 = 'http://localhost:4566';

    expect(forcePathStylePassedToS3Client()).toBe(true);
  });

  test('is left unset by default', () => {
    expect(forcePathStylePassedToS3Client()).toBeUndefined();
  });
});
