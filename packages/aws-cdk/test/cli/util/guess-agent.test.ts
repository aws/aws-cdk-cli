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

test.each([
  ['AI_AGENT', 'claude-code'],
  ['AGENT', '1'],
  ['CLAUDECODE', '1'],
  ['CODEX_THREAD_ID', 'thread-123'],
  ['CODEX_SANDBOX', '1'],
  ['CODEX_CI', '1'],
  ['CURSOR_AGENT', '1'],
  ['VSCODE_AGENT', '1'],
  ['CLINE_ACTIVE', 'true'],
  ['GEMINI_CLI', '1'],
  ['OPENCODE', '1'],
  ['COPILOT_CLI', '1'],
  ['AUGMENT_AGENT', '1'],
  ['QWEN_CODE', '1'],
])('detects %s', (envVar, value) => {
  process.env[envVar] = value;
  expect(guessAgent()).toBe(true);
});

test.each([
  ['AmazonQ-For-CLI Version/1.23.1'],
  ['kiro'],
])('detects AWS_EXECUTION_ENV %s', (value) => {
  process.env.AWS_EXECUTION_ENV = value;
  expect(guessAgent()).toBe(true);
});

test('returns undefined without agent variables', () => {
  expect(guessAgent()).toBeUndefined();
});

test('an empty value does not count', () => {
  process.env.CLAUDECODE = '';
  expect(guessAgent()).toBeUndefined();
});

test.each([
  // User configuration for these tools does not mean they are running the command
  ['CODEX_HOME', '/home/user/.codex'],
  ['CLINE_API_KEY', 'secret'],
  ['AWS_EXECUTION_ENV', 'AWS_Lambda_nodejs22.x'],
])('does not misdetect %s', (envVar, value) => {
  process.env[envVar] = value;
  expect(guessAgent()).toBeUndefined();
});
