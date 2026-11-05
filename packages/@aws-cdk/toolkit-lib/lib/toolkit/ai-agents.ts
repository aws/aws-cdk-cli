interface AiAgent {
  /**
   * Short name of the agent
   */
  readonly name: string;

  /**
   * What environment variable indicates that this agent is executing the command?
   */
  readonly detectEnvVar: string;

  /**
   * If set, the value of the environment variable must include this (case-insensitive)
   *
   * @default - any non-empty value
   */
  readonly detectValue?: string;
}

/**
 * Environment variables that indicate an AI agent is executing the command.
 *
 * Only variables set by the agent itself when running commands belong here.
 * Variables that merely indicate an agent-capable IDE or environment
 * (e.g. CURSOR_TRACE_ID, REPL_ID) do not: a human typing in such a terminal
 * would be misdetected.
 *
 * Each entry links to the documentation or source code that establishes the variable.
 * Agent-specific variables come first, so they win over the generic ones at the end.
 */
const AI_AGENTS: AiAgent[] = [
  // https://code.claude.com/docs/en/env-vars#variables
  { name: 'claude-code', detectEnvVar: 'CLAUDECODE' },
  // https://github.com/openai/codex/blob/4a942885c8b4745757a9f86ad2075e16c42483c5/codex-rs/protocol/src/shell_environment.rs#L7
  { name: 'codex', detectEnvVar: 'CODEX_THREAD_ID' },
  // https://github.com/openai/codex/blob/4a942885c8b4745757a9f86ad2075e16c42483c5/codex-rs/core/src/spawn.rs#L26
  { name: 'codex', detectEnvVar: 'CODEX_SANDBOX' },
  // https://github.com/openai/codex/blob/4a942885c8b4745757a9f86ad2075e16c42483c5/codex-rs/core/src/unified_exec/process_manager.rs#L93
  { name: 'codex', detectEnvVar: 'CODEX_CI' },
  // https://cursor.com/docs/agent/terminal#disable-heavy-prompts-for-cursor-sessions
  { name: 'cursor', detectEnvVar: 'CURSOR_AGENT' },
  // https://code.visualstudio.com/updates/v1_121#_agentaware-terminal-commands
  { name: 'vscode', detectEnvVar: 'VSCODE_AGENT' },
  // https://github.com/cline/cline/blob/16875140fbc7bae51aad79c203837b4f51e54aa5/apps/vscode/src/hosts/vscode/terminal/VscodeTerminalRegistry.ts#L31
  { name: 'cline', detectEnvVar: 'CLINE_ACTIVE' },
  // https://google-gemini.github.io/gemini-cli/docs/tools/shell.html#environment-variables
  { name: 'gemini-cli', detectEnvVar: 'GEMINI_CLI' },
  // https://github.com/anomalyco/opencode/blob/b155b15694dbcc6768f11d2f25cc2bdd1f738ab4/packages/opencode/src/index.ts#L76
  { name: 'opencode', detectEnvVar: 'OPENCODE' },
  // https://github.com/github/copilot-cli/blob/3f9c5e1ce792150a852804132e2b08c58e9a8e95/changelog.md#L1971
  { name: 'copilot-cli', detectEnvVar: 'COPILOT_CLI' },
  // https://docs.augmentcode.com/cli/reference#shell-environment
  { name: 'augment', detectEnvVar: 'AUGMENT_AGENT' },
  // https://github.com/QwenLM/qwen-code/blob/099a71c9364473303adb31e0dfb5f488b31634d9/packages/core/src/services/shellExecutionService.ts#L806
  { name: 'qwen-code', detectEnvVar: 'QWEN_CODE' },
  // Amazon Q CLI and Kiro identify themselves in the value of AWS_EXECUTION_ENV
  // https://github.com/aws/amazon-q-developer-cli/blob/15cc8f3cd18c4272925ce1c7053268eedff1ea0a/crates/chat-cli/src/cli/chat/consts.rs#L31
  { name: 'amazon-q', detectEnvVar: 'AWS_EXECUTION_ENV', detectValue: 'amazonq' },
  { name: 'kiro', detectEnvVar: 'AWS_EXECUTION_ENV', detectValue: 'kiro' },
  // https://github.com/vercel/detect-agent/blob/3ab1df1e4eaae153cf66f4a5018e4c5854855212/README.md#the-ai_agent-standard
  { name: 'other', detectEnvVar: 'AI_AGENT' },
  // Amp, Crush, Goose, opencode; e.g. https://github.com/charmbracelet/crush/blob/7d78d7422a92918441a68d01d96d48fa3b9fd9db/internal/shell/shell.go#L46
  { name: 'other', detectEnvVar: 'AGENT' },
];

/**
 * Detect the AI agent executing the command based on environment variables, if possible.
 *
 * Returns `undefined` if no agent can be detected.
 */
export function detectAiAgent(): AiAgent | undefined {
  return AI_AGENTS.find((agent) => {
    const value = process.env[agent.detectEnvVar];
    if (!value) {
      return false;
    }
    return agent.detectValue === undefined || value.toLocaleLowerCase().includes(agent.detectValue);
  });
}

/**
 * Guess whether we're being executed by an AI agent
 *
 * It's hard for us to say `false` for sure, so we only respond
 * with `yes` or `don't know`.
 */
export function guessAgent(): true | undefined {
  return detectAiAgent() ? true : undefined;
}
