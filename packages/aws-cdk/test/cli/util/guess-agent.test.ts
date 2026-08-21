import { guessAgent } from '../../../lib/cli/util/guess-agent';

// Replace the environment wholesale, so tests are unaffected by the
// agent (if any) running this test suite
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = process.env;
  process.env = { PATH: originalEnv.PATH };
});

afterEach(() => {
  process.env = originalEnv;
});

test('detects agent environment variables', () => {
  const agentVars = [
    'AI_AGENT', 'AGENT',
    'CLAUDECODE', 'CODEX_THREAD_ID', 'CODEX_SANDBOX', 'CODEX_CI',
    'CURSOR_AGENT', 'VSCODE_AGENT', 'CLINE_ACTIVE', 'GEMINI_CLI',
    'OPENCODE', 'COPILOT_CLI', 'AUGMENT_AGENT', 'QWEN_CODE',
  ];

  for (const envVar of agentVars) {
    process.env = { PATH: originalEnv.PATH, [envVar]: '1' };
    expect(guessAgent()).toBe(true);
  }
});

test('detects Amazon Q and Kiro in AWS_EXECUTION_ENV', () => {
  for (const value of ['AmazonQ-For-CLI Version/1.23.1', 'kiro']) {
    process.env.AWS_EXECUTION_ENV = value;
    expect(guessAgent()).toBe(true);
  }
});

test('returns undefined in a clean environment', () => {
  expect(guessAgent()).toBeUndefined();
});

test.each([
  ['CLAUDECODE', ''],
  ['CODEX_HOME', '/home/user/.codex'],
  ['CLINE_API_KEY', 'secret'],
  ['AWS_EXECUTION_ENV', 'AWS_Lambda_nodejs22.x'],
])('does not misdetect %s=%s', (envVar, value) => {
  process.env[envVar] = value;
  expect(guessAgent()).toBeUndefined();
});
