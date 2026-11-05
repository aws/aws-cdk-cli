import { detectAiAgent, guessAgent } from '../../lib/toolkit/ai-agents';

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
  ['AI_AGENT', 'other'],
  ['AGENT', 'other'],
  ['CLAUDECODE', 'claude-code'],
  ['CODEX_THREAD_ID', 'codex'],
  ['CODEX_SANDBOX', 'codex'],
  ['CODEX_CI', 'codex'],
  ['CURSOR_AGENT', 'cursor'],
  ['VSCODE_AGENT', 'vscode'],
  ['CLINE_ACTIVE', 'cline'],
  ['GEMINI_CLI', 'gemini-cli'],
  ['OPENCODE', 'opencode'],
  ['COPILOT_CLI', 'copilot-cli'],
  ['AUGMENT_AGENT', 'augment'],
  ['QWEN_CODE', 'qwen-code'],
])('detects %s as %s', (envVar, name) => {
  process.env[envVar] = '1';
  expect(detectAiAgent()?.name).toBe(name);
  expect(guessAgent()).toBe(true);
});

test.each([
  ['AmazonQ-For-CLI Version/1.23.1', 'amazon-q'],
  ['kiro', 'kiro'],
])('detects AWS_EXECUTION_ENV=%s as %s', (value, name) => {
  process.env.AWS_EXECUTION_ENV = value;
  expect(detectAiAgent()?.name).toBe(name);
  expect(guessAgent()).toBe(true);
});

test('prefers a specific agent over the generic variables', () => {
  process.env.AGENT = '1';
  process.env.CLAUDECODE = '1';
  expect(detectAiAgent()?.name).toBe('claude-code');
});

test('returns undefined in a clean environment', () => {
  expect(detectAiAgent()).toBeUndefined();
  expect(guessAgent()).toBeUndefined();
});

test.each([
  ['CLAUDECODE', ''],
  ['CODEX_HOME', '/home/user/.codex'],
  ['CLINE_API_KEY', 'secret'],
  ['AWS_EXECUTION_ENV', 'AWS_Lambda_nodejs22.x'],
])('does not misdetect %s=%s', (envVar, value) => {
  process.env[envVar] = value;
  expect(detectAiAgent()).toBeUndefined();
  expect(guessAgent()).toBeUndefined();
});
