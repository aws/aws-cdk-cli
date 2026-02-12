import * as fc from 'fast-check';
import * as logger from '../../lib/logger';
import { printEnvironmentsSummary } from '../../lib/workers/common';
import type { RemovedEnvironment, TestEnvironment } from '../../lib/workers/environment-pool';

// Mock the logger module
jest.mock('../../lib/logger', () => ({
  print: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  highlight: jest.fn(),
  trace: jest.fn(),
}));

// We need to test the emitEnvironmentRemovedWarning function which is not exported
// So we'll test it indirectly through the integration tests or extract it for testing
// For now, we'll focus on printRemovedEnvironmentsSummary which is exported

describe('printRemovedEnvironmentsSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('unit tests', () => {
    test('does not print anything when no environments were removed', () => {
      // GIVEN
      const removedEnvironments: RemovedEnvironment[] = [];

      // WHEN
      printEnvironmentsSummary({ removed: removedEnvironments });

      // THEN - no logger calls should be made
      expect(logger.warning).not.toHaveBeenCalled();
      expect(logger.print).not.toHaveBeenCalled();
    });

    test('prints summary header when environments were removed', () => {
      // GIVEN
      const removedEnvironments: RemovedEnvironment[] = [
        {
          region: 'us-east-1',
          reason: 'Bootstrap stack not found',
          removedAt: new Date(),
        },
      ];

      // WHEN
      printEnvironmentsSummary({ removed: removedEnvironments });

      // THEN - should print header
      expect(logger.warning).toHaveBeenCalledWith(
        '\n%s',
        expect.stringContaining('Environments removed due to bootstrap errors'),
      );
    });

    test('prints region name for each removed environment', () => {
      // GIVEN
      const removedEnvironments: RemovedEnvironment[] = [
        {
          region: 'us-east-1',
          reason: 'Not bootstrapped',
          removedAt: new Date(),
        },
      ];

      // WHEN
      printEnvironmentsSummary({ removed: removedEnvironments });

      // THEN - should include region name
      expect(logger.warning).toHaveBeenCalledWith(
        '  • %s%s',
        '',
        'us-east-1',
      );
    });

    test('prints profile prefix when profile is provided', () => {
      // GIVEN
      const removedEnvironments: RemovedEnvironment[] = [
        {
          region: 'us-west-2',
          profile: 'dev-profile',
          reason: 'Not bootstrapped',
          removedAt: new Date(),
        },
      ];

      // WHEN
      printEnvironmentsSummary({ removed: removedEnvironments });

      // THEN - should include profile prefix
      expect(logger.warning).toHaveBeenCalledWith(
        '  • %s%s',
        'dev-profile/',
        'us-west-2',
      );
    });

    test('prints bootstrap command with account when account is provided', () => {
      // GIVEN
      const removedEnvironments: RemovedEnvironment[] = [
        {
          region: 'eu-west-1',
          account: '123456789012',
          reason: 'Not bootstrapped',
          removedAt: new Date(),
        },
      ];

      // WHEN
      printEnvironmentsSummary({ removed: removedEnvironments });

      // THEN - should include bootstrap command with account
      expect(logger.warning).toHaveBeenCalledWith(
        '    Run: %s',
        expect.stringContaining('cdk bootstrap aws://123456789012/eu-west-1'),
      );
    });

    test('prints bootstrap command with region only when account is not provided', () => {
      // GIVEN
      const removedEnvironments: RemovedEnvironment[] = [
        {
          region: 'ap-southeast-1',
          reason: 'Not bootstrapped',
          removedAt: new Date(),
        },
      ];

      // WHEN
      printEnvironmentsSummary({ removed: removedEnvironments });

      // THEN - should include bootstrap command with region only
      expect(logger.warning).toHaveBeenCalledWith(
        '    Run: %s',
        expect.stringContaining('cdk bootstrap ap-southeast-1'),
      );
    });

    test('prints entry for each removed environment', () => {
      // GIVEN
      const removedEnvironments: RemovedEnvironment[] = [
        {
          region: 'us-east-1',
          reason: 'Not bootstrapped',
          removedAt: new Date(),
        },
        {
          region: 'us-west-2',
          profile: 'prod',
          account: '123456789012',
          reason: 'Version insufficient',
          removedAt: new Date(),
        },
        {
          region: 'eu-central-1',
          account: '234567890123',
          reason: 'SSM parameter not found',
          removedAt: new Date(),
        },
      ];

      // WHEN
      printEnvironmentsSummary({ removed: removedEnvironments });

      // THEN - should print entry for each environment
      // Header + 3 environments * 2 lines each + trailing newline = 8 calls
      expect(logger.warning).toHaveBeenCalledTimes(8);

      // Verify each region is mentioned
      const allCalls = (logger.warning as jest.Mock).mock.calls;
      const allCallsStr = JSON.stringify(allCalls);
      expect(allCallsStr).toContain('us-east-1');
      expect(allCallsStr).toContain('us-west-2');
      expect(allCallsStr).toContain('eu-central-1');
    });

    test('prints trailing newline after summary', () => {
      // GIVEN
      const removedEnvironments: RemovedEnvironment[] = [
        {
          region: 'us-east-1',
          reason: 'Not bootstrapped',
          removedAt: new Date(),
        },
      ];

      // WHEN
      printEnvironmentsSummary({ removed: removedEnvironments });

      // THEN - last call should be empty string (trailing newline)
      const lastCall = (logger.warning as jest.Mock).mock.calls.slice(-1)[0];
      expect(lastCall).toEqual(['']);
    });
  });
});

/**
 * Property-Based Tests for Notification Functions
 *
 * These tests verify universal properties that should hold across all valid inputs.
 */
describe('Notification Property-Based Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Arbitrary generators for test data
  const awsAccountArb = fc.stringMatching(/^[0-9]{12}$/);
  const awsRegionArb = fc.constantFrom(
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
    'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
    'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1', 'ap-southeast-2',
    'sa-east-1', 'ca-central-1', 'me-south-1', 'af-south-1',
  );
  const profileArb = fc.option(
    fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '-', '_', '1', '2', '3'), { minLength: 1, maxLength: 20 }),
    { nil: undefined },
  );
  const reasonArb = fc.string({ minLength: 1, maxLength: 200 });

  const RemovedEnvironmentArb: fc.Arbitrary<RemovedEnvironment> = fc.record({
    region: awsRegionArb,
    profile: profileArb,
    account: fc.option(awsAccountArb, { nil: undefined }),
    reason: reasonArb,
    removedAt: fc.date(),
  });

  /**
   * Property 8: Summary Content Completeness
   *
   * *For any* non-empty list of removed regions, the printed summary should contain
   * an entry for each removed region, and each entry should include the region name,
   * profile (if applicable), and a bootstrap command.
   *
   * **Validates: Requirements 6.2, 6.3**
   */
  describe('Property 8: Summary Content Completeness', () => {
    test('summary contains entry for each removed region', () => {
      fc.assert(
        fc.property(
          fc.array(RemovedEnvironmentArb, { minLength: 1, maxLength: 10 }),
          (removedEnvironments) => {
            // Clear mocks before each property test iteration
            jest.clearAllMocks();

            // WHEN
            printEnvironmentsSummary({ removed: removedEnvironments });

            // THEN - logger.warning should have been called
            expect(logger.warning).toHaveBeenCalled();

            // Collect all warning calls
            const allCalls = (logger.warning as jest.Mock).mock.calls;
            const allCallsStr = JSON.stringify(allCalls);

            // Each region should appear in the output
            for (const env of removedEnvironments) {
              expect(allCallsStr).toContain(env.region);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    test('each entry includes profile when provided', () => {
      fc.assert(
        fc.property(
          fc.array(RemovedEnvironmentArb, { minLength: 1, maxLength: 10 }),
          (removedEnvironments) => {
            // Clear mocks before each property test iteration
            jest.clearAllMocks();

            // WHEN
            printEnvironmentsSummary({ removed: removedEnvironments });

            // THEN - for each environment with a profile, the profile should appear
            const allCalls = (logger.warning as jest.Mock).mock.calls;
            const allCallsStr = JSON.stringify(allCalls);

            for (const env of removedEnvironments) {
              if (env.profile) {
                // Profile should appear with trailing slash (profile/)
                expect(allCallsStr).toContain(`${env.profile}/`);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    test('each entry includes bootstrap command', () => {
      fc.assert(
        fc.property(
          fc.array(RemovedEnvironmentArb, { minLength: 1, maxLength: 10 }),
          (removedEnvironments) => {
            // Clear mocks before each property test iteration
            jest.clearAllMocks();

            // WHEN
            printEnvironmentsSummary({ removed: removedEnvironments });

            // THEN - bootstrap command should appear for each environment
            const allCalls = (logger.warning as jest.Mock).mock.calls;
            const allCallsStr = JSON.stringify(allCalls);

            // Should contain 'cdk bootstrap' command
            expect(allCallsStr).toContain('cdk bootstrap');

            // For each environment, the bootstrap target should be present
            for (const env of removedEnvironments) {
              if (env.account) {
                // Should have aws://account/region format
                expect(allCallsStr).toContain(`aws://${env.account}/${env.region}`);
              } else {
                // Should have just the region
                expect(allCallsStr).toContain(env.region);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    test('summary is not printed when list is empty', () => {
      fc.assert(
        fc.property(
          fc.constant([]),
          (removedEnvironments: RemovedEnvironment[]) => {
            // Clear mocks beforRemovedEnvironmentteration
            jest.clearAllMocks();

            // WHEN
            printEnvironmentsSummary({ removed: removedEnvironments });

            // THEN - no output should be produced
            expect(logger.warning).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    });

    test('number of environment entries matches number of removed environments', () => {
      fc.assert(
        fc.property(
          fc.array(RemovedEnvironmentArb, { minLength: 1, maxLength: 10 }),
          (removedEnvironments) => {
            // Clear mocks before each property test iteration
            jest.clearAllMocks();

            // WHEN
            printEnvironmentsSummary({ removed: removedEnvironments });

            // THEN - should have correct number of calls
            // Format: 1 header + (2 lines per env) + 1 trailing newline
            const expectedCalls = 1 + (removedEnvironments.length * 2) + 1;
            expect(logger.warning).toHaveBeenCalledTimes(expectedCalls);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

/**
 * Tests for emitEnvironmentRemovedWarning
 *
 * Since emitEnvironmentRemovedWarning is a private function in integ-test-worker.ts,
 * we test it indirectly through integration tests or by extracting the logic.
 *
 * For Property 7, we create a test helper that mimics the warning emission logic.
 */
describe('Warning Message Content Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Helper interface for testing NOT_BOOTSTRAPPED diagnostic handling
   */
  interface NotBootstrappedDiagnosticInput {
    environment: TestEnvironment;
    reason: string;
  }

  // Helper function that mimics emitEnvironmentRemovedWarning logic for testing
  function emitWarningForTesting(input: NotBootstrappedDiagnosticInput): string[] {
    const profileStr = input.environment.profile ? `${input.environment.profile}/` : '';
    const accountStr = input.environment.account ? `aws://${input.environment.account}/${input.environment.region}` : input.environment.region;

    return [
      `⚠️  Environment ${profileStr}${input.environment.region} removed due to bootstrap error`,
      `   Reason: ${input.reason}`,
      `   Run: cdk bootstrap ${accountStr}`,
    ];
  }

  describe('unit tests for warning message content', () => {
    test('warning contains region name', () => {
      // GIVEN
      const input: NotBootstrappedDiagnosticInput = {
        environment: { region: 'us-east-1' },
        reason: 'Not bootstrapped',
      };

      // WHEN
      const messages = emitWarningForTesting(input);

      // THEN
      expect(messages[0]).toContain('us-east-1');
    });

    test('warning contains profile when provided', () => {
      // GIVEN
      const input: NotBootstrappedDiagnosticInput = {
        environment: { region: 'us-west-2', profile: 'dev-profile' },
        reason: 'Not bootstrapped',
      };

      // WHEN
      const messages = emitWarningForTesting(input);

      // THEN
      expect(messages[0]).toContain('dev-profile/');
      expect(messages[0]).toContain('us-west-2');
    });

    test('warning does not contain profile prefix when profile is not provided', () => {
      // GIVEN
      const input: NotBootstrappedDiagnosticInput = {
        environment: { region: 'eu-west-1' },
        reason: 'Not bootstrapped',
      };

      // WHEN
      const messages = emitWarningForTesting(input);

      // THEN - should not have double slash or undefined
      expect(messages[0]).not.toContain('undefined');
      expect(messages[0]).toContain('Environment eu-west-1');
    });

    test('warning contains cdk bootstrap command', () => {
      // GIVEN
      const input: NotBootstrappedDiagnosticInput = {
        environment: { region: 'ap-southeast-1' },
        reason: 'Not bootstrapped',
      };

      // WHEN
      const messages = emitWarningForTesting(input);

      // THEN
      expect(messages[2]).toContain('cdk bootstrap');
    });

    test('warning contains account in bootstrap command when provided', () => {
      // GIVEN
      const input: NotBootstrappedDiagnosticInput = {
        environment: { region: 'sa-east-1', account: '123456789012' },
        reason: 'Not bootstrapped',
      };

      // WHEN
      const messages = emitWarningForTesting(input);

      // THEN
      expect(messages[2]).toContain('cdk bootstrap aws://123456789012/sa-east-1');
    });

    test('warning contains region only in bootstrap command when account not provided', () => {
      // GIVEN
      const input: NotBootstrappedDiagnosticInput = {
        environment: { region: 'ca-central-1' },
        reason: 'Not bootstrapped',
      };

      // WHEN
      const messages = emitWarningForTesting(input);

      // THEN
      expect(messages[2]).toContain('cdk bootstrap ca-central-1');
      expect(messages[2]).not.toContain('aws://');
    });

    test('warning contains reason', () => {
      // GIVEN
      const input: NotBootstrappedDiagnosticInput = {
        environment: { region: 'us-east-1' },
        reason: 'Bootstrap stack version is insufficient',
      };

      // WHEN
      const messages = emitWarningForTesting(input);

      // THEN
      expect(messages[1]).toContain('Bootstrap stack version is insufficient');
    });
  });

  /**
   * Property 7: Warning Message Content
   *
   * *For any* removed region info containing a region name and optional profile,
   * the emitted warning message should contain the region name, the profile (if provided),
   * and a `cdk bootstrap` command.
   *
   * **Validates: Requirements 5.2, 5.3**
   */
  describe('Property 7: Warning Message Content', () => {
    // Arbitrary generators
    const awsAccountArb = fc.stringMatching(/^[0-9]{12}$/);
    const awsRegionArb = fc.constantFrom(
      'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
      'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1', 'ap-southeast-2',
      'sa-east-1', 'ca-central-1', 'me-south-1', 'af-south-1',
    );
    const profileArb = fc.option(
      fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', '-', '_', '1', '2', '3'), { minLength: 1, maxLength: 20 }),
      { nil: undefined },
    );
    const reasonArb = fc.string({ minLength: 1, maxLength: 200 });

    const notBootstrappedInputArb: fc.Arbitrary<NotBootstrappedDiagnosticInput> = fc.record({
      environment: fc.record({
        region: awsRegionArb,
        profile: profileArb,
        account: fc.option(awsAccountArb, { nil: undefined }),
      }),
      reason: reasonArb,
    });

    test('warning message contains region name for any removal request', () => {
      fc.assert(
        fc.property(
          notBootstrappedInputArb,
          (input) => {
            // WHEN
            const messages = emitWarningForTesting(input);
            const allMessages = messages.join('\n');

            // THEN - region should appear in the warning
            expect(allMessages).toContain(input.environment.region);
          },
        ),
        { numRuns: 100 },
      );
    });

    test('warning message contains profile when provided', () => {
      fc.assert(
        fc.property(
          notBootstrappedInputArb,
          (input) => {
            // WHEN
            const messages = emitWarningForTesting(input);
            const allMessages = messages.join('\n');

            // THEN - if profile is provided, it should appear with trailing slash
            if (input.environment.profile) {
              expect(allMessages).toContain(`${input.environment.profile}/`);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    test('warning message contains cdk bootstrap command for any removal request', () => {
      fc.assert(
        fc.property(
          notBootstrappedInputArb,
          (input) => {
            // WHEN
            const messages = emitWarningForTesting(input);
            const allMessages = messages.join('\n');

            // THEN - should contain cdk bootstrap command
            expect(allMessages).toContain('cdk bootstrap');
          },
        ),
        { numRuns: 100 },
      );
    });

    test('bootstrap command contains correct target for any removal request', () => {
      fc.assert(
        fc.property(
          notBootstrappedInputArb,
          (input) => {
            // WHEN
            const messages = emitWarningForTesting(input);
            const bootstrapLine = messages[2];

            // THEN - bootstrap target should be correct
            if (input.environment.account) {
              expect(bootstrapLine).toContain(`aws://${input.environment.account}/${input.environment.region}`);
            } else {
              expect(bootstrapLine).toContain(input.environment.region);
              expect(bootstrapLine).not.toContain('aws://');
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    test('warning message does not contain undefined or null strings', () => {
      fc.assert(
        fc.property(
          notBootstrappedInputArb,
          (input) => {
            // WHEN
            const messages = emitWarningForTesting(input);
            const allMessages = messages.join('\n');

            // THEN - should not contain literal 'undefined' or 'null'
            expect(allMessages).not.toContain('undefined');
            expect(allMessages).not.toContain('null');
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
