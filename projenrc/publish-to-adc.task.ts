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
  const buckets = TARGET_BUCKETS.split(/\s+|,+/).filter(x => x);

  const root = 'dist/standalone';
  const filesToPublish = ['aws-cdk-cli.zip'];

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

  for (const bucket of buckets) {
    // This value is secret-ish, mask it out
    // this is a cli
    // eslint-disable-next-line no-console
    console.log(`::add-mask::${bucket}`);

    for (const file of filesToPublish) {
      const upload = new Upload({
        client: s3,
        params: {
          Bucket: bucket,
          Key: `aws-cdk-v2/${file}`,
          Body: createReadStream(`${root}/${file}`),
          ChecksumAlgorithm: 'SHA256',
        },
      });
      await upload.done();
    }
  }
}

main().catch(e => {
  // this is a cli
  // eslint-disable-next-line no-console
  console.error(e);
  process.exitCode = 1;
});
