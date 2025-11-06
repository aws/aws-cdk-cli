import { NetworkDetector } from '@aws-cdk/toolkit-lib';
import * as nock from 'nock';
import { exec } from '../../lib/cli/cli';

// Mock NetworkDetector
jest.mock('@aws-cdk/toolkit-lib', () => ({
  ...jest.requireActual('@aws-cdk/toolkit-lib'),
  NetworkDetector: {
    hasConnectivity: jest.fn(),
  },
}));

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

  // Mock NetworkDetector to return true by default for all tests, regardless of parameters
  (NetworkDetector.hasConnectivity as jest.Mock).mockImplementation(() => Promise.resolve(true));
});

describe('cdk notices', () => {
  test('will fail on dns error', async () => {
    // GIVEN
    nock(NOTICES_URL)
      .get(NOTICES_PATH)
      .replyWithError('DNS resolution failed');

    expect.assertions(2);
    try {
      await exec(['notices']);
    } catch (error: any) {
      // THEN
      await expect(error.message).toMatch('Failed to load CDK notices');
      await expect(error.cause.message).toMatch('DNS resolution failed');
    }
  });

  test('will fail on timeout', async () => {
    // GIVEN
    nock(NOTICES_URL)
      .get(NOTICES_PATH)
      .delayConnection(3500)
      .reply(200, {
        notices: [BASIC_NOTICE],
      });

    // WHEN
    expect.assertions(2);
    try {
      await exec(['notices']);
    } catch (error: any) {
      // THEN
      await expect(error.message).toMatch('Failed to load CDK notices');
      await expect(error.cause.message).toMatch('Request timed out');
    }
  });
});
