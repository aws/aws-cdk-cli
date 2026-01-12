import { restUrlFromManifest } from '../../../lib/api/cloudformation/template-body-parameter';

test('restUrlFromManifest ignores AWS_ENDPOINT_URL_S3', async () => {
  process.env.AWS_ENDPOINT_URL_S3 = 'https://boop.com/';
  try {
    await expect(restUrlFromManifest('s3://my-bucket/object', {
      account: '123456789012',
      region: 'us-east-1',
      name: 'env',
    })).resolves.toEqual('https://s3.us-east-1.amazonaws.com/my-bucket/object');
  } finally {
    delete process.env.AWS_ENDPOINT_URL_S3;
  }
});

test('restUrlFromManifest respects AWS_ENDPOINT_URL_S3_FOR_CLOUDFORMATION', async () => {
  process.env.AWS_ENDPOINT_URL_S3_FOR_CLOUDFORMATION = 'https://boop.com/';
  try {
    await expect(restUrlFromManifest('s3://my-bucket/object', {
      account: '123456789012',
      region: 'us-east-1',
      name: 'env',
    })).resolves.toEqual('https://boop.com/my-bucket/object');
  } finally {
    delete process.env.AWS_ENDPOINT_URL_S3_FOR_CLOUDFORMATION;
  }
});
