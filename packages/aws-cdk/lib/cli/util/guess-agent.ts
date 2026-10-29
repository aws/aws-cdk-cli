/**
 * Environment variables that indicate an AI agent is executing the command.
 *
 * Only variables set by the agent itself when running commands belong here.
 * Variables that merely indicate an agent-capable IDE or environment
 * (e.g. CURSOR_TRACE_ID, REPL_ID) do not: a human typing in such a terminal
 * would be misdetected.
 *
 * Each entry links to the documentation or source code that establishes the variable.
 */
const AGENT_ENV_VARS = [
  // https://github.com/vercel/detect-agent/blob/3ab1df1e4eaae153cf66f4a5018e4c5854855212/README.md#the-ai_agent-standard
  'AI_AGENT',
  // Amp, Crush, Goose, opencode; e.g. https://github.com/charmbracelet/crush/blob/7d78d7422a92918441a68d01d96d48fa3b9fd9db/internal/shell/shell.go#L46
  'AGENT',
  // https://code.claude.com/docs/en/env-vars#variables
  'CLAUDECODE',
  // https://github.com/openai/codex/blob/4a942885c8b4745757a9f86ad2075e16c42483c5/codex-rs/protocol/src/shell_environment.rs#L7
  'CODEX_THREAD_ID',
  // https://github.com/openai/codex/blob/4a942885c8b4745757a9f86ad2075e16c42483c5/codex-rs/core/src/spawn.rs#L26
  'CODEX_SANDBOX',
  // https://github.com/openai/codex/blob/4a942885c8b4745757a9f86ad2075e16c42483c5/codex-rs/core/src/unified_exec/process_manager.rs#L93
  'CODEX_CI',
  // https://cursor.com/docs/agent/terminal#disable-heavy-prompts-for-cursor-sessions
  'CURSOR_AGENT',
  // https://code.visualstudio.com/updates/v1_121#_agentaware-terminal-commands
  'VSCODE_AGENT',
  // https://github.com/cline/cline/blob/16875140fbc7bae51aad79c203837b4f51e54aa5/apps/vscode/src/hosts/vscode/terminal/VscodeTerminalRegistry.ts#L31
  'CLINE_ACTIVE',
  // https://google-gemini.github.io/gemini-cli/docs/tools/shell.html#environment-variables
  'GEMINI_CLI',
  // https://github.com/anomalyco/opencode/blob/b155b15694dbcc6768f11d2f25cc2bdd1f738ab4/packages/opencode/src/index.ts#L76
  'OPENCODE',
  // https://github.com/github/copilot-cli/blob/3f9c5e1ce792150a852804132e2b08c58e9a8e95/changelog.md#L1971
  'COPILOT_CLI',
  // https://docs.augmentcode.com/cli/reference#shell-environment
  'AUGMENT_AGENT',
  // https://github.com/QwenLM/qwen-code/blob/099a71c9364473303adb31e0dfb5f488b31634d9/packages/core/src/services/shellExecutionService.ts#L806
  'QWEN_CODE',
];

/**
 * Guess whether we're being executed by an AI agent
 *
 * It's hard for us to say `false` for sure, so we only respond
 * with `yes` or `don't know`.
 */
export function guessAgent(): true | undefined {
  if (AGENT_ENV_VARS.some((envVar) => process.env[envVar])) {
    return true;
  }

  // Amazon Q CLI and Kiro identify themselves in the value of AWS_EXECUTION_ENV
  // https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/chat-cli/src/cli/chat/consts.rs#L31
  const awsExecutionEnv = (process.env.AWS_EXECUTION_ENV ?? '').toLocaleLowerCase();
  if (awsExecutionEnv.includes('amazonq') || awsExecutionEnv.includes('kiro')) {
    return true;
  }

  return undefined;
}
