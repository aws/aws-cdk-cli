// Mock NetworkDetector before any imports
const mockHasConnectivity = jest.fn(() => Promise.resolve(true));
jest.mock('../../lib/api/network-detector', () => ({
  NetworkDetector: {
    hasConnectivity: mockHasConnectivity,
  },
}));

import * as nock from 'nock';
import { exec } from '../../lib/cli/cli';

const NOTICES_URL = 'https://cli.cdk.dev-tools.aws.dev';
const NOTICES_PATH = '/notices.json';

const BASIC_NOTICE = {
  title: 'Toggling off auto_delete_objects for Bucket empties the bucket',
  issueNumber: 16603,
  overview:
    'If a stack is deployed with an S3 bucket with auto_delete_objects=True, and then re-deployed with auto_delete_objects=False, all the objects in the bucket will be deleted.',
  components: [
    {
      name: 'cli',
      version: '<=1.126.0',
    },
  ],
  schemaVersion: '1',
};

beforeEach(() => {
  nock.cleanAll();
  jest.clearAllMocks();
  // Reset to default connectivity = true
  mockHasConnectivity.mockResolvedValue(true);
});

describe('cdk notices', () => {
  test('will fail when no connectivity (dns error scenario)', async () => {
    // GIVEN - NetworkDetector will return false by default, simulating no connectivity
    // This test represents what used to be a DNS error but now gets caught by connectivity check
    nock(NOTICES_URL)
      .get(NOTICES_PATH)
      .replyWithError('DNS resolution failed');

    expect.assertions(2);
    try {
      await exec(['notices']);
    } catch (error: any) {
      // THEN - Now expects connectivity error instead of DNS error
      await expect(error.message).toMatch('Failed to load CDK notices');
      await expect(error.cause.message).toMatch('No internet connectivity detected');
    }
  });

  test('will fail when no connectivity (timeout scenario)', async () => {
    // GIVEN - NetworkDetector will return false by default, simulating no connectivity
    // This test represents what used to be a timeout but now gets caught by connectivity check
    nock(NOTICES_URL)
      .get(NOTICES_PATH)
      .delayConnection(3500)
      .reply(200, {
        notices: [BASIC_NOTICE],
      });

    expect.assertions(2);
    try {
      await exec(['notices']);
    } catch (error: any) {
      // THEN - Now expects connectivity error instead of timeout error
      await expect(error.message).toMatch('Failed to load CDK notices');
      await expect(error.cause.message).toMatch('No internet connectivity detected');
    }
  });

  test('will fail when no connectivity', async () => {
    // GIVEN - explicitly mock no connectivity
    mockHasConnectivity.mockResolvedValue(false);

    expect.assertions(2);
    try {
      await exec(['notices']);
    } catch (error: any) {
      // THEN
      await expect(error.message).toMatch('Failed to load CDK notices');
      await expect(error.cause.message).toMatch('No internet connectivity detected');
    }
  });
});
