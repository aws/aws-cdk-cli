/* eslint-disable import/no-restricted-paths */

// Node.js built-in modules
import * as path from 'node:path';
import * as os from 'node:os';

// Third-party modules
import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';

// Local modules
import {
  MockSdk,
  MockSdkProvider,
  mockCloudFormationClient,
  mockS3Client,
  mockSTSClient,
  setDefaultSTSMocks,
  restoreSdkMocksToDefault,
} from '../../../../aws-cdk/test/util/mock-sdk';

import {
  SdkProvider,
  Bootstrapper,
  type StringWithoutPlaceholders
} from '../../lib/api/aws-cdk';

// Re-exports
export { path };
export { os };
export { cxapi };
export { fs };
export {
  MockSdk,
  MockSdkProvider,
  mockCloudFormationClient,
  mockS3Client,
  mockSTSClient,
  setDefaultSTSMocks,
  restoreSdkMocksToDefault,
};
export {
  SdkProvider,
  Bootstrapper,
  type StringWithoutPlaceholders
};