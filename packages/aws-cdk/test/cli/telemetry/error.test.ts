import { AuthenticationError } from '@aws-cdk/toolkit-lib';
import { cdkCliErrorName } from '../../../lib/cli/telemetry/error';

test('returns known error names', () => {
  expect(cdkCliErrorName(AuthenticationError.name)).toEqual(AuthenticationError.name);
});

test('returns UnknownError for unknown error names', () => {
  expect(cdkCliErrorName('ExpiredToken')).toEqual('UnknownError');
});