/**
 * Values of `CDK_AGENT` that turn agentic mode off. Any other non-empty value turns it on,
 * so both `CDK_AGENT=1` and a descriptive value such as `CDK_AGENT=kiro` work.
 */
const FALSY_ENV_VALUES = ['0', 'false', 'no', 'off'];

/**
 * Determine whether agentic mode was explicitly turned on or off.
 *
 * - `true`: on, via `--agent` or `CDK_AGENT`
 * - `false`: explicitly off, via `--no-agent` or a falsy `CDK_AGENT` (also disables AI agent auto-detection)
 * - `undefined`: not specified, so AI agent auto-detection applies
 *
 * An `--agent` / `--no-agent` flag on the command line wins over `CDK_AGENT`.
 *
 * `CDK_AGENT` is interpreted here rather than left to yargs, because yargs only
 * accepts `true` as a true value for boolean environment variables, and turns
 * `CDK_AGENT=1` into `false`.
 *
 * Agentic mode is deliberately not read from `cdk.json` or `~/.cdk.json`: those files
 * are shared with humans, who would otherwise get agent-optimized output too.
 */
export function resolveAgentMode(args: string[], parsedAgent: boolean | undefined, env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  if (hasAgentFlag(args)) {
    return parsedAgent;
  }

  const value = env.CDK_AGENT?.trim().toLowerCase();
  if (value === undefined || value === '') {
    return undefined;
  }
  return !FALSY_ENV_VALUES.includes(value);
}

/**
 * Whether an `--agent` or `--no-agent` flag appears on the command line, before any `--` separator.
 */
function hasAgentFlag(args: string[]): boolean {
  for (const arg of args) {
    if (arg === '--') {
      return false;
    }
    if (arg === '--agent' || arg === '--no-agent' || arg.startsWith('--agent=')) {
      return true;
    }
  }
  return false;
}
