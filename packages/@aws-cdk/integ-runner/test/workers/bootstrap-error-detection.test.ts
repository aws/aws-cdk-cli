import { BootstrapError, ToolkitError, AuthenticationError, AssemblyError } from '@aws-cdk/toolkit-lib';
import * as fc from 'fast-check';
import { detectBootstrapError } from '../../lib/workers/bootstrap-error-detection';

describe('detectBootstrapError', () => {
  describe('detection of typed BootstrapError instances', () => {
    test('detects BootstrapError and returns isBootstrapError: true', () => {
      // GIVEN
      const error = new BootstrapError('Bootstrap stack not found', {
        account: '123456789012',
        region: 'us-east-1',
      });

      // WHEN
      const result = detectBootstrapError(error);

      // THEN
      expect(result.isBootstrapError).toBe(true);
      expect(result.message).toBe('Bootstrap stack not found');
    });

    test('detects BootstrapError with cause', () => {
      // GIVEN
      const cause = new Error('underlying error');
      const error = new BootstrapError('Bootstrap failed', {
        account: '987654321098',
        region: 'eu-west-1',
      }, cause);

      // WHEN
      const result = detectBootstrapError(error);

      // THEN
      expect(result.isBootstrapError).toBe(true);
      expect(result.message).toBe('Bootstrap failed');
    });
  });

  describe('region extraction from BootstrapError', () => {
    test('extracts region from BootstrapError environment', () => {
      // GIVEN
      const error = new BootstrapError('Not bootstrapped', {
        account: '111122223333',
        region: 'ap-southeast-1',
      });

      // WHEN
      const result = detectBootstrapError(error);

      // THEN
      expect(result.region).toBe('ap-southeast-1');
    });

    test('extracts account from BootstrapError environment', () => {
      // GIVEN
      const error = new BootstrapError('Not bootstrapped', {
        account: '444455556666',
        region: 'us-west-2',
      });

      // WHEN
      const result = detectBootstrapError(error);

      // THEN
      expect(result.account).toBe('444455556666');
    });

    test('extracts both region and account correctly', () => {
      // GIVEN
      const error = new BootstrapError('Bootstrap version insufficient', {
        account: '777788889999',
        region: 'sa-east-1',
      });

      // WHEN
      const result = detectBootstrapError(error);

      // THEN
      expect(result.isBootstrapError).toBe(true);
      expect(result.region).toBe('sa-east-1');
      expect(result.account).toBe('777788889999');
      expect(result.message).toBe('Bootstrap version insufficient');
    });
  });

  describe('returns isBootstrapError: false for non-bootstrap errors', () => {
    test('returns false for generic ToolkitError', () => {
      // GIVEN
      const error = new ToolkitError('Generic toolkit error');

      // WHEN
      const result = detectBootstrapError(error);

      // THEN
      expect(result.isBootstrapError).toBe(false);
      expect(result.region).toBeUndefined();
      expect(result.account).toBeUndefined();
      expect(result.message).toBe('Generic toolkit error');
    });

    test('returns false for AuthenticationError', () => {
      // GIVEN
      const error = new AuthenticationError('Authentication failed');

      // WHEN
      const result = detectBootstrapError(error);

      // THEN
      expect(result.isBootstrapError).toBe(false);
      expect(result.message).toBe('Authentication failed');
    });

    test('returns false for AssemblyError', () => {
      // GIVEN
      const error = AssemblyError.withCause('Assembly failed', new Error('cause'));

      // WHEN
      const result = detectBootstrapError(error);

      // THEN
      expect(result.isBootstrapError).toBe(false);
      expect(result.message).toBe('Assembly failed');
    });

    test('returns false for plain Error', () => {
      // GIVEN
      const error = new Error('Plain error');

      // WHEN
      const result = detectBootstrapError(error);

      // THEN
      expect(result.isBootstrapError).toBe(false);
      expect(result.message).toBe('Plain error');
    });

    test('returns false for string error', () => {
      // GIVEN
      const error = 'String error message';

      // WHEN
      const result = detectBootstrapError(error);

      // THEN
      expect(result.isBootstrapError).toBe(false);
      expect(result.message).toBe('String error message');
    });

    test('returns false for null', () => {
      // WHEN
      const result = detectBootstrapError(null);

      // THEN
      expect(result.isBootstrapError).toBe(false);
      expect(result.message).toBe('null');
    });

    test('returns false for undefined', () => {
      // WHEN
      const result = detectBootstrapError(undefined);

      // THEN
      expect(result.isBootstrapError).toBe(false);
      expect(result.message).toBe('undefined');
    });

    test('returns false for number', () => {
      // WHEN
      const result = detectBootstrapError(42);

      // THEN
      expect(result.isBootstrapError).toBe(false);
      expect(result.message).toBe('42');
    });

    test('returns false for object with message property', () => {
      // GIVEN
      const error = { message: 'fake error object' };

      // WHEN
      const result = detectBootstrapError(error);

      // THEN
      expect(result.isBootstrapError).toBe(false);
      expect(result.message).toBe('[object Object]');
    });
  });
});

/**
 * Property-Based Tests for detectBootstrapError
 *
 * These tests verify universal properties that should hold across all valid inputs.
 */
describe('detectBootstrapError Property-Based Tests', () => {
  // Arbitrary generators for test data
  const awsAccountArb = fc.stringMatching(/^[0-9]{12}$/);
  const awsRegionArb = fc.constantFrom(
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
    'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
    'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1', 'ap-southeast-2',
    'sa-east-1', 'ca-central-1', 'me-south-1', 'af-south-1',
  );
  const errorMessageArb = fc.string({ minLength: 1, maxLength: 200 });

  /**
   * Property 4: Bootstrap Error Detection and Region Extraction
   *
   * *For any* `BootstrapError` with an environment property, `detectBootstrapError()`
   * should return `isBootstrapError: true` and the `region` field should match the
   * error's `environment.region`.
   *
   * **Validates: Requirements 2.1, 2.2**
   */
  describe('Property 4: Bootstrap Error Detection and Region Extraction', () => {
    test('detectBootstrapError returns isBootstrapError: true for any BootstrapError', () => {
      fc.assert(
        fc.property(
          errorMessageArb,
          awsAccountArb,
          awsRegionArb,
          (message, account, region) => {
            // GIVEN - a BootstrapError with any valid environment
            const error = new BootstrapError(message, { account, region });

            // WHEN
            const result = detectBootstrapError(error);

            // THEN - should always detect as bootstrap error
            expect(result.isBootstrapError).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    test('region field matches error.environment.region for any BootstrapError', () => {
      fc.assert(
        fc.property(
          errorMessageArb,
          awsAccountArb,
          awsRegionArb,
          (message, account, region) => {
            // GIVEN - a BootstrapError with any valid environment
            const error = new BootstrapError(message, { account, region });

            // WHEN
            const result = detectBootstrapError(error);

            // THEN - region should match exactly
            expect(result.region).toBe(region);
            expect(result.region).toBe(error.environment.region);
          },
        ),
        { numRuns: 100 },
      );
    });

    test('account field matches error.environment.account for any BootstrapError', () => {
      fc.assert(
        fc.property(
          errorMessageArb,
          awsAccountArb,
          awsRegionArb,
          (message, account, region) => {
            // GIVEN - a BootstrapError with any valid environment
            const error = new BootstrapError(message, { account, region });

            // WHEN
            const result = detectBootstrapError(error);

            // THEN - account should match exactly
            expect(result.account).toBe(account);
            expect(result.account).toBe(error.environment.account);
          },
        ),
        { numRuns: 100 },
      );
    });

    test('message field matches error.message for any BootstrapError', () => {
      fc.assert(
        fc.property(
          errorMessageArb,
          awsAccountArb,
          awsRegionArb,
          (message, account, region) => {
            // GIVEN - a BootstrapError with any valid environment
            const error = new BootstrapError(message, { account, region });

            // WHEN
            const result = detectBootstrapError(error);

            // THEN - message should match exactly
            expect(result.message).toBe(message);
            expect(result.message).toBe(error.message);
          },
        ),
        { numRuns: 100 },
      );
    });

    test('all fields are correctly extracted together for any BootstrapError', () => {
      fc.assert(
        fc.property(
          errorMessageArb,
          awsAccountArb,
          awsRegionArb,
          fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
          (message, account, region, causeMessage) => {
            // GIVEN - a BootstrapError with optional cause
            const cause = causeMessage ? new Error(causeMessage) : undefined;
            const error = new BootstrapError(message, { account, region }, cause);

            // WHEN
            const result = detectBootstrapError(error);

            // THEN - all fields should be correctly extracted
            expect(result).toEqual({
              isBootstrapError: true,
              region: region,
              account: account,
              message: message,
            });
          },
        ),
        { numRuns: 100 },
      );
    });

    test('non-BootstrapError types always return isBootstrapError: false', () => {
      // Generator for various non-bootstrap error types
      const nonBootstrapErrorArb = fc.oneof(
        // Plain Error
        fc.string({ minLength: 1, maxLength: 100 }).map(msg => new Error(msg)),
        // ToolkitError
        fc.string({ minLength: 1, maxLength: 100 }).map(msg => new ToolkitError(msg)),
        // AuthenticationError
        fc.string({ minLength: 1, maxLength: 100 }).map(msg => new AuthenticationError(msg)),
        // String
        fc.string({ minLength: 0, maxLength: 100 }),
        // Number
        fc.integer(),
        // Null/undefined
        fc.constant(null),
        fc.constant(undefined),
        // Object without proper error structure
        fc.record({
          message: fc.string(),
          region: fc.string(),
        }),
      );

      fc.assert(
        fc.property(nonBootstrapErrorArb, (error) => {
          // WHEN
          const result = detectBootstrapError(error);

          // THEN - should never be detected as bootstrap error
          expect(result.isBootstrapError).toBe(false);
          expect(result.region).toBeUndefined();
          expect(result.account).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });
  });
});
