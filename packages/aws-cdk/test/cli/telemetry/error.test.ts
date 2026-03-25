import { AssemblyError, AuthenticationError } from '@aws-cdk/toolkit-lib';
import { ServiceException } from '@smithy/smithy-client';
import { cdkCliErrorName } from '../../../lib/cli/telemetry/error';

test('returns known error names', () => {
  expect(cdkCliErrorName(new AuthenticationError('Oh no'))).toEqual(AuthenticationError.name);
});

test('returns UnknownError for unknown error names', () => {
  expect(cdkCliErrorName(new Error('ExpiredToken: hot diddly'))).toEqual('UnknownError');
});

test('returns the synth error code if attached', () => {
  const err = AssemblyError.withCause('Synth failed', undefined);
  err.attachSynthesisErrorCode('SynthError');
  expect(cdkCliErrorName(err)).toEqual('synth:SynthError');
});

test('returns the AWS SDK error code if found', () => {
  const err = new ServiceException({ name: 'ServiceIsSleeping', $fault: 'server', $metadata: { } });
  expect(cdkCliErrorName(err)).toEqual('sdk:ServiceIsSleeping');
});

test('returns the error cause for a chained toolkit error', () => {
  const cause = AssemblyError.withCause('Synth failed', undefined);
  cause.attachSynthesisErrorCode('SynthError');

  const err = AssemblyError.withCause('Subprocess didn\'t do nothing', cause);
  expect(cdkCliErrorName(err)).toEqual('synth:SynthError');
});
