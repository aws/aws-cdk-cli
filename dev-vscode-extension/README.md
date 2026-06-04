# dev-vscode-extension — DEVELOPMENT ONLY

> **This is NOT the shipping CDK LSP integration.**
>
> The CDK LSP ships to VS Code users via the **AWS Toolkit** extension (see RFC).
> Non-VS-Code editors and AI agents point their LSP client directly at the LSP
> server entrypoint over stdio (see RFC §"Editor Integration").
>
> This folder exists **only** so contributors can press F5 in VS Code and exercise
> the LSP end-to-end while they're working on it. Do not publish this to the
> VS Code Marketplace. Do not depend on it from any shipped code path.

## What this folder is

A minimal VS Code extension whose only job is to spawn the local
`@aws-cdk/cdk-explorer` LSP server (`packages/@aws-cdk/cdk-explorer/lib/lsp/main.js`)
and connect it to a development VS Code window via stdio.

## How to use

1. Build the LSP server (once after pulling, and after any LSP source change):

   ```bash
   yarn workspace @aws-cdk/cdk-explorer build
   ```

2. Install + build this extension:

   ```bash
   cd dev-vscode-extension
   npm install
   npm run build
   ```

3. Open the **monorepo root** (`aws-cdk-cli/`) in VS Code, then press **F5**.

   VS Code's `extensionHost` debug config opens a second VS Code window with
   this extension loaded. Errors from `client.start()` go to the
   "Output" → "CDK LSP" channel of the second window.

4. In the second VS Code window, open a CDK project (TypeScript) and open one
   of its stack files. The dev extension activates and the LSP attaches.

   The LSP feature surface (diagnostics, CodeLens, etc.) lights up as those
   features land on `feat/cdk-lsp`. Opening a `.ts` file is enough to trigger
   activation today.

## Editing loop

- Edit LSP source under `packages/@aws-cdk/cdk-explorer/lib/lsp/` →
  `yarn workspace @aws-cdk/cdk-explorer compile` → in the second VS Code
  window, run "Developer: Reload Window" to restart the LSP.
- Edit this extension's source under `dev-vscode-extension/src/` →
  `npm run build` → close and re-launch the F5 debug session.
