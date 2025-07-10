import { promises as fs } from 'fs';
import * as path from 'path';
import type { TestFixture } from '../../../lib/with-cdk-app';

export async function writeFileAsset(fixture: TestFixture) {
  const account = await fixture.aws.account();
  const region = fixture.aws.region;

  const relativeAssetFile = 'testfile.txt';
  for (const toCreate of [relativeAssetFile]) {
    await fs.writeFile(path.join(fixture.integTestDir, toCreate), 'some asset file');
  }
  const bucketName = `cdk-hnb659fds-assets-${account}-${region}`;
  const assumeRoleArn = `arn:\${AWS::Partition}:iam::${account}:role/cdk-hnb659fds-file-publishing-role-${account}-${region}`;

  return {
    relativeAssetFile,
    bucketName,
    assumeRoleArn,
  };
}

export async function writeDockerAsset(fixture: TestFixture) {
  const relativeImageDir = 'imagedir';
  const absoluteImageDir = path.join(fixture.integTestDir, relativeImageDir);
  await fs.mkdir(absoluteImageDir, { recursive: true });

  for (const toCreate of [`${absoluteImageDir}/datafile.txt`]) {
    await fs.writeFile(toCreate, 'some asset file');
  }

  await fs.writeFile(path.join(absoluteImageDir, 'Dockerfile'), [
    'FROM scratch',
    'ADD datafile.txt datafile.txt',
  ].join('\n'));

  const account = await fixture.aws.account();
  const region = fixture.aws.region;
  const repositoryName = `cdk-hnb659fds-container-assets-${account}-${region}`;
  const assumeRoleArn = `arn:\${AWS::Partition}:iam::${account}:role/cdk-hnb659fds-image-publishing-role-${account}-${region}`;
  const repositoryDomain = `${account}.dkr.ecr.${region}.amazonaws.com`;

  return {
    repositoryName,
    assumeRoleArn,
    relativeImageDir,
    repositoryDomain,
  };
}
