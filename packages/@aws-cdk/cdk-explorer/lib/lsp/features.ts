import { SUPPORTED_COMMANDS } from './commands';

/**
 * Wire-protocol version for the CDK Language Server.
 *
 * Bump this ONLY on a breaking change to an existing feature's request/response
 * shape or semantics. Do NOT bump it for additive features -- those are
 * announced by name via `CDK_LSP_FEATURES`. A client rejects (or degrades
 * against) a server whose protocol exceeds the maximum it was built for.
 */
export const CDK_LSP_PROTOCOL = 1;

/**
 * Named capabilities a client can rely on. Add an entry here whenever you ship
 * a new LSP feature so clients can gate on it by name, instead of inferring
 * capability from the CDK CLI version number. Every entry MUST be backed by a
 * real capability or command (a test in server.test.ts guards against drift).
 */
export const CDK_LSP_FEATURES = ['hover', 'codeLens', 'definition', 'synth', 'autoSynth'] as const;

/**
 * The CDK-specific manifest advertised in the `initialize` response
 * (`capabilities.experimental.cdk`) and printed by `cdk lsp --features`. This
 * function is the single source of truth for both surfaces so they cannot drift.
 *
 * `version` is supplied by the `cdk` CLI entrypoint; the server is a library
 * and does not know its own shipped version, so the CLI injects it.
 */
export function cdkLspManifest(version?: string) {
  return {
    protocol: CDK_LSP_PROTOCOL,
    version,
    features: [...CDK_LSP_FEATURES],
    // Deliberately mirrors executeCommandProvider.commands on the wire so the
    // `cdk lsp --features` probe (which has no LSP session) can see them too.
    commands: [...SUPPORTED_COMMANDS],
  };
}
