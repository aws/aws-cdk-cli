import { AuthenticationError } from '@aws-cdk/toolkit-lib';
import { cdkCliErrorName } from '../../../lib/cli/telemetry/error';

test('returns known error names', () => {
  expect(cdkCliErrorName(new AuthenticationError('Oh no'))).toEqual(AuthenticationError.name);
});

test('returns UnknownError for unknown error names', () => {
  expect(cdkCliErrorName(new Error('ExpiredToken: damn'))).toEqual('UnknownError');
});
