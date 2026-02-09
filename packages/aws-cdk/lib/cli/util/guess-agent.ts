
/**
 * Guess whether we're being executed by an AI agent
 *
 * It's hard for us to say `false` for sure, so we only respond
 * with `yes` or `don't know`.
 */
export function guessAgent(): true | undefined {
  if ((process.env.AWS_EXECUTION_ENV ?? '').toLocaleLowerCase().includes('amazonq')) {
    return true;
  }

  if (process.env.CLAUDECODE) {
    return true;
  }

  // Expecting CODEX_SANDBOX, CODEX_THREAD_ID
  if (Object.keys(process.env).some(x => x.startsWith('CODEX_'))) {
    return true;
  }

  if (process.env.CURSOR_AGENT) {
    return true;
  }

  // Cline -- not sure if it sets these, but users might to configure Cline.
  if (Object.keys(process.env).some(x => x.startsWith('CLINE_'))) {
    return true;
  }

  // Copilot doesn't set an envvar (at least not in VS Code)

  return undefined;
}