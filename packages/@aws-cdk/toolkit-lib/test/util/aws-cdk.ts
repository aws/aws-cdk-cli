/* eslint-disable import/no-restricted-paths */

// Local modules
export {
  MockSdk,
  MockSdkProvider,
  mockCloudFormationClient,
  mockS3Client,
  mockSTSClient,
  setDefaultSTSMocks,
  restoreSdkMocksToDefault,
} from '../../../../aws-cdk/test/util/mock-sdk';

export { rootDir } from '../../../../aws-cdk/lib/util/directories';
