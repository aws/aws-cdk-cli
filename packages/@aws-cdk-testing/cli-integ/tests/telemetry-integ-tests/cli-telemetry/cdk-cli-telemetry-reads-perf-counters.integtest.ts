import * as path from 'path';
import * as fs from 'fs-extra';
import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'CLI Telemetry sends performance counters if emitted by the app',
  withSpecificFixture('perf-counters-app', async (fixture) => {
    const telemetryFile = path.join(fixture.integTestDir, 'telemetry.json');

    // Deploy stack while collecting telemetry
    await fixture.cdkSynth({
      telemetryFile,
      interact: [
        {
          prompt: /Send in for analysis/,
          input: 'y',
        },
      ],
    });

    const json = fs.readJSONSync(telemetryFile);
    expect(json).toContainEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: 'SYNTH_PERF_COUNTERS',
        }),
        counters: expect.objectContaining({
          ExampleCounter: 42,
        }),
      }),
    ]);
    fs.unlinkSync(telemetryFile);
  }),
);
