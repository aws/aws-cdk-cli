import { createReadStream } from 'fs';
import { S3 } from '@aws-sdk/client-s3';
import { fromTemporaryCredentials, fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Upload } from '@aws-sdk/lib-storage';

/**
 * Takes files from `dist/standalone` and moves them to specific ADC buckets
 */
async function main() {
  const PUBLISHING_ROLE_ARN = process.env.PUBLISHING_ROLE_ARN;
  if (!PUBLISHING_ROLE_ARN) {
    throw new Error('Require $PUBLISHING_ROLE_ARN');
  }

  const TARGET_BUCKETS = process.env.TARGET_BUCKETS;
  if (!TARGET_BUCKETS) {
    throw new Error('Require $TARGET_BUCKETS');
  }

  const credentials = fromTemporaryCredentials({
    masterCredentials: fromNodeProviderChain(),
    params: {
      RoleArn: PUBLISHING_ROLE_ARN,
      RoleSessionName: 'cdk-adc-publish',
    },
    clientConfig: {
      region: 'us-east-1',
    },
  });

  const s3 = new S3({ region: 'us-east-1', credentials });

  for (const bucket of TARGET_BUCKETS.split(' ')) {
    // This value is secret-ish, mask it out
    // this is a cli
    // eslint-disable-next-line no-console
    console.log(`::add-mask::${bucket}`);

    const upload = new Upload({
      client: s3,
      params: {
        Bucket: bucket,
        Key: 'aws-cdk-v2/aws-cdk-cli.zip',
        Body: createReadStream('dist/standalone/aws-cdk-cli.zip'),
        ChecksumAlgorithm: 'SHA256',
      },
    });
    await upload.done();
  }
}

main().catch(e => {
  // this is a cli
  // eslint-disable-next-line no-console
  console.error(e);
  process.exitCode = 1;
});
