/**
 * Environment variables that indicate an AI agent is executing the command.
 *
 * Only variables set by the agent itself when running commands belong here.
 * Variables that merely indicate an agent-capable IDE or environment
 * (e.g. CURSOR_TRACE_ID, REPL_ID) do not: a human typing in such a terminal
 * would be misdetected.
 */
const AGENT_ENV_VARS = [
  // Generic convention adopted by multiple agents
  'AI_AGENT',
  'AGENT',

  'CLAUDECODE', // Claude Code
  'CODEX_THREAD_ID', // OpenAI Codex CLI
  'CODEX_SANDBOX',
  'CODEX_CI',
  'CURSOR_AGENT', // Cursor CLI
  'VSCODE_AGENT', // VS Code agent-aware terminal
  'CLINE_ACTIVE', // Cline
  'GEMINI_CLI', // Gemini CLI
  'OPENCODE', // opencode
  'COPILOT_CLI', // GitHub Copilot CLI; Copilot in VS Code sets no envvar
  'AUGMENT_AGENT', // Augment
  'QWEN_CODE', // Qwen Code
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
  const awsExecutionEnv = (process.env.AWS_EXECUTION_ENV ?? '').toLocaleLowerCase();
  if (awsExecutionEnv.includes('amazonq') || awsExecutionEnv.includes('kiro')) {
    return true;
  }

  return undefined;
}
