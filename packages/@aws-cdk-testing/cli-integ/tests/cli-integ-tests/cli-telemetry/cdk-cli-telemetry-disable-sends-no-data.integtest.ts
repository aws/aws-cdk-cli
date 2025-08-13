import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'CLI Telemetry --disable does not send to endpoint',
  withDefaultFixture(async (fixture) => {
    const output = await fixture.cdk(['cli-telemetry', '--disable'], { options: ['-vvv'] });

    // Check the trace that telemetry was not executed successfully
    expect(output).not.toContain('Telemetry Sent Successfully');

    // Check the trace that endpoint telemetry was never connected
    expect(output).toContain('Endpoint Telemetry NOT connected');
  }),
);
