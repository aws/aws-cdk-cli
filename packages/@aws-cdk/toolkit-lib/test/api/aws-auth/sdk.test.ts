import { Agent } from 'node:https';
import cloudformation from '@aws-sdk/client-cloudformation';
import lambda from '@aws-sdk/client-lambda';
import s3 from '@aws-sdk/client-s3';
import { sdkRequestHandler } from '../../../lib/api/aws-auth/awscli-compatible';
import { defaultCliUserAgent } from '../../../lib/api/aws-auth/private';
import { SDK } from '../../../lib/api/aws-auth/sdk';
import { FAKE_CREDENTIAL_CHAIN, MockSdk } from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

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

describe('socket timeout', () => {
  const agent = new Agent();
  let sdk: SDK;
  let lambdaClientSpy: jest.SpyInstance;
  let cloudFormationClientSpy: jest.SpyInstance;

  beforeEach(() => {
    sdk = new SDK(FAKE_CREDENTIAL_CHAIN, 'bermuda-triangle-1337', sdkRequestHandler(agent), new TestIoHost().asHelper('sdk'));
    lambdaClientSpy = jest.spyOn(lambda, 'LambdaClient').mockImplementation(() => ({}) as any);
    cloudFormationClientSpy = jest.spyOn(cloudformation, 'CloudFormationClient').mockImplementation(() => ({}) as any);
  });

  afterEach(() => {
    lambdaClientSpy.mockRestore();
    cloudFormationClientSpy.mockRestore();
  });

  test('outlasts the longest synchronous Lambda invoke', () => {
    sdk.lambda();

    expect(lambdaClientSpy.mock.calls[0][0].requestHandler).toEqual({
      ...sdkRequestHandler(agent),
      socketTimeout: 905_000,
    });
  });

  test('keeps the shared value for other clients', () => {
    sdk.cloudFormation();

    expect(cloudFormationClientSpy.mock.calls[0][0].requestHandler).toEqual(sdkRequestHandler(agent));
  });
});

describe('User-Agent', () => {
  let s3ClientSpy: jest.SpyInstance;

  beforeEach(() => {
    s3ClientSpy = jest.spyOn(s3, 'S3Client').mockImplementation(() => ({}) as any);
  });

  afterEach(() => {
    s3ClientSpy.mockRestore();
  });

  function customUserAgentPassedToClient(sdk: MockSdk) {
    sdk.s3();
    return s3ClientSpy.mock.calls[0][0].customUserAgent;
  }

  test('sends the CLI name and version as a single token', () => {
    expect(customUserAgentPassedToClient(new MockSdk())).toEqual([[defaultCliUserAgent()]]);
  });

  test('appendCustomUserAgent() adds to the CLI token', () => {
    const sdk = new MockSdk();
    sdk.appendCustomUserAgent('cdk-migrate');

    expect(customUserAgentPassedToClient(sdk)).toEqual([[`${defaultCliUserAgent()} cdk-migrate`]]);
  });

  test('appendCustomUserAgent() sends metadata as separate aws-cdk tokens after the CLI token', () => {
    const sdk = new MockSdk();
    sdk.appendCustomUserAgent('cdk-migrate');
    sdk.appendCustomUserAgent({ key: 'agent', value: 'kiro' });
    sdk.appendCustomUserAgent({ key: 'ci', value: 'github' });

    expect(customUserAgentPassedToClient(sdk)).toEqual([
      [`${defaultCliUserAgent()} cdk-migrate`],
      ['aws-cdk/agent', 'kiro'],
      ['aws-cdk/ci', 'github'],
    ]);
  });

  test('appendCustomUserAgent() replaces the value of an existing key', () => {
    const sdk = new MockSdk();
    sdk.appendCustomUserAgent({ key: 'ci', value: 'github' });
    sdk.appendCustomUserAgent({ key: 'ci', value: 'gitlab' });

    expect(customUserAgentPassedToClient(sdk)).toEqual([[defaultCliUserAgent()], ['aws-cdk/ci', 'gitlab']]);
  });

  test('removeCustomUserAgent() removes metadata by key', () => {
    const sdk = new MockSdk();
    sdk.appendCustomUserAgent({ key: 'agent', value: 'kiro' });
    sdk.appendCustomUserAgent({ key: 'ci', value: 'github' });
    sdk.removeCustomUserAgent({ key: 'agent', value: 'kiro' });

    expect(customUserAgentPassedToClient(sdk)).toEqual([[defaultCliUserAgent()], ['aws-cdk/ci', 'github']]);
  });

  test.each(['aws-cdk/agent', 'agent#kiro', 'my agent', ''])('appendCustomUserAgent() rejects metadata key %p', (key) => {
    expect(() => new MockSdk().appendCustomUserAgent({ key, value: 'kiro' })).toThrow(/invalid User-Agent metadata key/);
  });

  test('appendCustomUserAgent() replaces # in the metadata value', () => {
    const sdk = new MockSdk();
    sdk.appendCustomUserAgent({ key: 'agent', value: 'kiro#1.2' });

    expect(customUserAgentPassedToClient(sdk)).toEqual([[defaultCliUserAgent()], ['aws-cdk/agent', 'kiro-1.2']]);
  });
});
