import { Context } from '../../../lib/api/context';
import { canCollectTelemetry } from '../../../lib/cli/telemetry/collect-telemetry';
import { withEnv } from '../../_helpers/with-env';

describe(canCollectTelemetry, () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  test('returns true by default', async () => {
    expect(canCollectTelemetry(context)).toBeTruthy();
  });

  test('returns false if env variable is set to true', async () => {
    await withEnv(async () => {
      expect(canCollectTelemetry(context)).toBeFalsy();
    }, {
      CDK_DISABLE_CLI_TELEMETRY: 'true',
    });
  });

  test('returns false if env variable is set to 1', async () => {
    await withEnv(async () => {
      expect(canCollectTelemetry(context)).toBeFalsy();
    }, {
      CDK_DISABLE_CLI_TELEMETRY: '1',
    });
  });

  test('returns false if context is set to false', async () => {
    context.set('cli-telemetry', false);
    expect(canCollectTelemetry(context)).toBeFalsy();

    context.set('cli-telemetry', 'false');
    expect(canCollectTelemetry(context)).toBeFalsy();
  });

  test('returns true if context is set to true', async () => {
    context.set('cli-telemetry', true);
    expect(canCollectTelemetry(context)).toBeTruthy();

    context.set('cli-telemetry', 'true');
    expect(canCollectTelemetry(context)).toBeTruthy();
  });
});
