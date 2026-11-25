import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { recordApiCallOnError } from '../../../lib/api/aws-auth/private';
import { formatErrorMessage, sdkApiCallOf } from '../../../lib/util';

/**
 * A request handler that answers every request with the given HTTP response
 */
function respondWith(statusCode: number, body: string, headers: Record<string, string> = {}) {
  return {
    handle: async () => ({
      response: {
        statusCode,
        headers: { 'content-type': 'application/xml', ...headers },
        body: Buffer.from(body),
      },
    }),
  };
}

const commonConfig = {
  region: 'us-east-1',
  credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
  maxAttempts: 1,
};

test('records the failing API call on service errors', async () => {
  const client = recordApiCallOnError(new S3Client({
    ...commonConfig,
    requestHandler: respondWith(403, '<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>'),
  }));

  const error = await client.send(new GetObjectCommand({ Bucket: 'bucket', Key: 'key' })).catch((e) => e);

  // The error itself is unchanged...
  expect(error.name).toBe('AccessDenied');
  expect(error.message).toBe('Access Denied');
  // ...but formatting it says which call failed
  expect(sdkApiCallOf(error)).toBe('S3.GetObject');
  expect(formatErrorMessage(error)).toBe('S3.GetObject: Access Denied');
});

test('records the failing API call on network errors', async () => {
  const client = recordApiCallOnError(new CloudFormationClient({
    ...commonConfig,
    requestHandler: {
      handle: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    },
  }));

  const error = await client.send(new DescribeStacksCommand({})).catch((e) => e);

  expect(error.message).toBe('connect ECONNREFUSED');
  expect(formatErrorMessage(error)).toBe('CloudFormation.DescribeStacks: connect ECONNREFUSED');
});

test('does not change how the error serializes', async () => {
  const client = recordApiCallOnError(new S3Client({
    ...commonConfig,
    requestHandler: respondWith(403, '<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>'),
  }));

  const error = await client.send(new GetObjectCommand({ Bucket: 'bucket', Key: 'key' })).catch((e) => e);

  expect(Object.keys(error)).not.toContainEqual(expect.stringContaining('ApiCall'));
  expect(JSON.stringify(error)).not.toContain('S3.GetObject');
});

test('successful calls are not affected', async () => {
  const client = recordApiCallOnError(new CloudFormationClient({
    ...commonConfig,
    requestHandler: respondWith(200, [
      '<DescribeStacksResponse><DescribeStacksResult><Stacks><member>',
      '<StackName>MyStack</StackName>',
      '</member></Stacks></DescribeStacksResult></DescribeStacksResponse>',
    ].join('')),
  }));

  const response = await client.send(new DescribeStacksCommand({}));

  expect(response.Stacks?.[0]?.StackName).toBe('MyStack');
});
