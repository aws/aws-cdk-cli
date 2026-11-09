import { cliUserAgentMetadata } from '../../lib/cli/user-agent';

// Replace the environment wholesale, so tests are unaffected by the
// agent or CI system (if any) running this test suite
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = process.env;
  process.env = { PATH: originalEnv.PATH };
});

afterEach(() => {
  process.env = originalEnv;
});

test('is empty in a clean environment', () => {
  expect(cliUserAgentMetadata()).toEqual([]);
});

test('reports that an agent and a CI system were detected', () => {
  process.env.AWS_EXECUTION_ENV = 'kiro';
  process.env.GITHUB_ACTION = 'run';

  expect(cliUserAgentMetadata()).toEqual([
    { key: 'agent', value: 'true' },
    { key: 'ci', value: 'true' },
  ]);
});

test('reports CI when only CI is set', () => {
  process.env.CI = 'true';

  expect(cliUserAgentMetadata()).toEqual([{ key: 'ci', value: 'true' }]);
});
