import * as s3 from '@aws-sdk/client-s3';
import { MockSdk } from '../../_helpers/mock-sdk';

describe('CDK_S3_FORCE_PATH_STYLE', () => {
  let s3ClientSpy: jest.SpyInstance;
  const originalValue = process.env.CDK_S3_FORCE_PATH_STYLE;

  beforeEach(() => {
    s3ClientSpy = jest.spyOn(s3, 'S3Client').mockImplementation(() => ({}) as any);
  });

  afterEach(() => {
    s3ClientSpy.mockRestore();
    if (originalValue === undefined) {
      delete process.env.CDK_S3_FORCE_PATH_STYLE;
    } else {
      process.env.CDK_S3_FORCE_PATH_STYLE = originalValue;
    }
  });

  test('forces path-style addressing on the S3 client when set', () => {
    process.env.CDK_S3_FORCE_PATH_STYLE = '1';

    new MockSdk().s3();

    expect(s3ClientSpy).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: true }));
  });

  test('leaves path-style addressing unset on the S3 client when not set', () => {
    delete process.env.CDK_S3_FORCE_PATH_STYLE;

    new MockSdk().s3();

    expect(s3ClientSpy).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: undefined }));
  });
});
