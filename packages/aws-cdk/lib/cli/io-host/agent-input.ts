import { stripVTControlCharacters } from 'node:util';
import { ToolkitError } from '@aws-cdk/toolkit-lib';
import type { IoRequest } from '@aws-cdk/toolkit-lib';

/**
 * Error code for a prompt that agentic mode refused to show.
 */
export const AGENT_INPUT_REQUIRED = 'AgentInputRequired';

interface PromptHint {
  /**
   * What the agent can do instead of answering the prompt.
   */
  readonly hint: string;

  /**
   * Whether the prompt guards a security-sensitive or destructive action.
   * For these, the error says that a human must approve first.
   */
  readonly needsHumanApproval: boolean;
}

/**
 * How to answer each prompt without interaction, by request code.
 */
const PROMPT_HINTS: Record<string, PromptHint> = {
  CDK_TOOLKIT_I5060: { needsHumanApproval: true, hint: 're-run with --require-approval never' },
  CDK_TOOLKIT_I5050: { needsHumanApproval: true, hint: 're-run with --force' },
  CDK_TOOLKIT_I7010: { needsHumanApproval: true, hint: 're-run with --force' },
  CDK_TOOLKIT_I8810: { needsHumanApproval: true, hint: 're-run with --yes' },
  CDK_TOOLKIT_I8910: { needsHumanApproval: true, hint: 're-run with --force' },
  CDK_TOOLKIT_I9210: { needsHumanApproval: true, hint: 're-run with --confirm=false' },
  CDK_TOOLKIT_I3100: { needsHumanApproval: false, hint: 'provide the resource identifiers with --resource-mapping <file> or --resource-mapping-inline <json>' },
  CDK_TOOLKIT_I3110: { needsHumanApproval: false, hint: 'provide the resource identifiers with --resource-mapping <file> or --resource-mapping-inline <json>' },
  CDK_TOOLKIT_I9300: { needsHumanApproval: false, hint: 're-run with --yes to accept the changes' },
  CDK_SDK_I1100: { needsHumanApproval: false, hint: 'an MFA token cannot be entered in agentic mode; obtain session credentials before running the command' },
};

const FALLBACK_HINT: PromptHint = { needsHumanApproval: false, hint: 're-run with --yes to accept the recommended answer' };

/**
 * The error thrown in agentic mode instead of showing a prompt.
 *
 * Names the question and its request code, and says how to proceed without interaction.
 * For security-sensitive and destructive prompts it also says that a human must approve first,
 * so an agent does not approve such changes on its own.
 */
export function agentInputRequiredError(msg: IoRequest<unknown, unknown>, motivation?: string): ToolkitError {
  const { hint, needsHumanApproval } = PROMPT_HINTS[msg.code] ?? FALLBACK_HINT;

  const lines = [`Input required: "${question(msg.message)}" (${msg.code}), but agentic mode never prompts.`];
  if (needsHumanApproval) {
    const reason = motivation ? `${motivation}. ` : '';
    lines.push(`${reason}A human must review the output above and approve before you proceed.`);
    lines.push(`After approval, ${hint}.`);
  } else {
    lines.push(`To proceed, ${hint}.`);
  }

  return new ToolkitError(AGENT_INPUT_REQUIRED, lines.join('\n'));
}

/**
 * Whether the given error is an agentic mode `AgentInputRequired` error.
 */
export function isAgentInputRequiredError(x: unknown): x is ToolkitError {
  return ToolkitError.isToolkitError(x) && x.name === AGENT_INPUT_REQUIRED;
}

/**
 * The question itself: the last non-empty line of the prompt text, without styling.
 *
 * Some prompts (such as the deploy approval) put a diff or explanation in front of the question.
 */
function question(message: string): string {
  const lines = stripVTControlCharacters(message).split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return lines[lines.length - 1] ?? message;
}
