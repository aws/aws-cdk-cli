import { integTest, withDefaultFixture } from '../../lib';

integTest(
  'CLI Telemetry --disable does not send to endpoint',
  withDefaultFixture(async (fixture) => {
    const output = await fixture.cdk(['cli-telemetry', '--disable'], { verboseLevel: 3 });

    // Check the trace that telemetry was never handed to a sender
    expect(output).not.toContain('Telemetry dispatched');

    // Check the trace that endpoint telemetry was never connected
    expect(output).toContain('Endpoint Telemetry NOT connected');
  }),
);
