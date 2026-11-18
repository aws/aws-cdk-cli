import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Initialize temp directory before mocking
const tempDir = path.join(os.tmpdir(), `telemetry-state-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
const statePath = path.join(tempDir, 'telemetry-state.json');

// Mock the util module to use our temp directory
const mockCdkCacheDir = jest.fn(() => tempDir);
jest.mock('../../../lib/util', () => ({
  cdkCacheDir: mockCdkCacheDir,
}));

// Now import after mocking
import { withTelemetryState } from '../../../lib/cli/telemetry/telemetry-state';

describe(withTelemetryState, () => {
  beforeEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  test('does not rewrite the file when the state is unchanged', async () => {
    // GIVEN
    fs.writeFileSync(statePath, JSON.stringify({ sequentialDeploymentFailures: 0 }));
    const past = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(statePath, past, past);

    // WHEN: a successful deploy, with no failures before it
    await withTelemetryState((state) => {
      state.sequentialDeploymentFailures = 0;
    });

    // THEN
    expect(fs.statSync(statePath).mtime).toEqual(past);
  });

  test('a state file cut short by an interrupted write counts as empty and is replaced', async () => {
    // GIVEN
    fs.writeFileSync(statePath, '{ "sequentialDeploymentFailures": 2');

    // WHEN
    const failures = await withTelemetryState((state) => {
      state.sequentialDeploymentFailures = (state.sequentialDeploymentFailures ?? 0) + 1;
      return state.sequentialDeploymentFailures;
    });

    // THEN
    expect(failures).toEqual(1);
    expect(JSON.parse(fs.readFileSync(statePath, 'utf-8'))).toEqual({ sequentialDeploymentFailures: 1 });
  });
});
