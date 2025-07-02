import { Context } from '@aws-cdk/toolkit-lib/lib/api/context';
import { canCollectTelemetry } from '../../../lib/cli/telemetry/collect-telemetry';

describe(canCollectTelemetry, () => {
  let context: Context; 
  beforeEach(() => {
    context = new Context();
  });

  test('returns true by default', async () => {
    expect(canCollectTelemetry(context)).toBeTruthy();
  });

  test('returns false if env variable is set', async () => {
    process.env.DISABLE_CLI_TELEMETRY = 'true';
    expect(canCollectTelemetry(context)).toBeTruthy();
  });

  test('returns false if context is set', async () => {
    context.set('cli-telemetry', true);
    expect(canCollectTelemetry(context)).toBeTruthy();

    context.set('cli-telemetry', 'true');
    expect(canCollectTelemetry(context)).toBeTruthy();
  });
});
